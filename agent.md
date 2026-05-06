# ARCA Agent / AFIP

## Tareas completadas

- Módulo **WSAA LoginCms (homologación)** en `src/arca/wsaa.ts`:
  - `createLoginTicketRequest()` — XML TRA con ventanas ±10 min y `uniqueId` por timestamp.
  - `signCMS()` — firma PKCS#7 DER vía `openssl cms -sign` (cert `.crt` + clave `.key`).
  - `parseWSAAResponse()` — incluye fragmento `<loginCmsReturn>` **normalizado** (CDATA, PI, XML escapado con entidades hasta doble nivel) + extracción **regex** opcional (`coerceXmlLeafText` para nodos `#text`, tags con prefijo de namespace opcional).
  - `loadTAFromDisk()` / `saveTAToDisk()` / `isTAExpired()` — persistencia dev en **`tmp/ta.json`** (sync).
  - `fetchWsaaLoginTicket()` — POST SOAP siempre a `ARCA_WSAA_URL_DEV`.
  - `getWsaaTicketAccess()` — orden: **memoria** → **`tmp/ta.json`** → **WSAA**; ante `coe.alreadyAuthenticated`, reintenta con disco si el TA guardado sigue vigente.
  - `loginWSAA()` — alias de `fetchWsaaLoginTicket()` (retrocompatibilidad).
- En **desarrollo** se loguean **token y sign completos** en consola (`logReturnedTa`). No apto para producción.
- Tras **`saveTAToDisk`** se confirma por log: ruta absoluta vía `cwd` + tamaño en bytes del archivo.
- `.gitignore` en raíz ignora **`tmp/`** (el JSON del TA es sensible).
- Dependencias añadidas: `axios`, `fast-xml-parser`.
- **Ruta** `GET /arca/wsaa/login` — devuelve `generationTime`; **409** si AFIP marca TA válido pero no hay entrada usable en `./tmp/ta.json` (ni TA en memoria).
- Módulo **WSFEv1 (homologación)** en `src/arca/wsfev1.ts`:
  - Wrapper `loadTAFromDisk()` sobre `wsaa`; `buildSoapEnvelope()`, `callWSFEV1()`, `parseWsfeSoapXml()`.
  - `feCompUltimoAutorizado({ ptoVta, cbteTipo })` — SOAP 1.1, ns `http://ar.gov.afip.dif.FEV1/`; parsea `Envelope.Body.FECompUltimoAutorizadoResponse.FECompUltimoAutorizadoResult` (campos `PtoVta`, `CbteTipo`, `CbteNro`; ya no se usa `ResultGet`); si hay `Errors` en ese nodo, error explícito; log debug solo esos tres campos.
  - `feCAESolicitar()` — `FECAESolicitar` con `FeCAEReq` / `FeCabReq` / `FeDetReq` / **`FECAEDetRequest`** (incluye `CondicionIVAReceptorId` tras `MonCotiz`); previo `FECompUltimoAutorizado`; `nextNumber = CbteNro + 1`. Log temporal: SOAP completo antes del POST (quitar en prod).
  - Parser `distillFecaSolicitarResponse`: lectura prioritario `FECAEDetResponse`, fallback `FECAEADetailResponse`; `observations[]` desde `Observaciones`/`Observations` (`Obs`).
  - `feCompConsultar({ ptoVta, cbteTipo, cbteNro })` — `FECompConsultar` con `FeCompConsReq` (orden CbteTipo, CbteNro, PtoVta); devuelve copia de `ResultGet` o `null` si el comprobante no existe (hueco / código 602 u otro mensaje “not found”).
  - `listWsfeVouchers({ ptoVta, cbteTipo, limit?, fromDate?, toDate? })` — obtiene último con `FECompUltimoAutorizado` (sin log de credenciales ni debug de consola); recorre números hacia atrás llamando `FECompConsultar`, como máximo hasta **5000** iteraciones; `limit` efectivo 1–100 (por defecto 20); filtro opcional por `CbteFch` yyyymmdd.
  - `loadTaAndCuitForWsfe()` + `buildAuthBlock(..., { logPreview })` para reutilizar TA/CUIT y silenciar previews en listado/consultas puntuales.
  - Body Zod **create-voucher**: `condicionIVAReceptorId` opcional — obligatorio si `docTipo !== 99`; si es consumidor final (`docTipo === 99`) y se omite, se usa **5**.
  - En logs WSFE no se muestra token/sign completo (solo prefijo corto cuando `logPreview` está activo).
- **Ruta** `GET /arca/wsfe/vouchers` — obligatorios `ptoVta`, `cbteTipo`; `limit` opcional default 20, máximo 100; `fromDate`/`toDate` yyyymmdd opcionales; respuesta `{ ok, ptoVta, cbteTipo, lastVoucherNumber, count, vouchers[] }`.
- **Ruta** `POST /arca/wsfe/create-voucher` — `FECAESolicitar` homo; body Zod (+ regla anterior); respuesta `observations: string[]`; `ok` solo si CAE informado y `result === "A"` (caso rechazo observable sin CAE, p. ej. `R`, `ok=false` con observaciones en el payload).
- Carga de `.env` al arrancar el servidor (`import "dotenv/config"` en `src/server.ts`).

## Variables de entorno esperadas

Definir variables en **`.env` en la raíz del repo** (cargado al arrancar con `dotenv/config`).

- `ARCA_WSAA_URL_DEV` — endpoint WSAA homo.
- `ARCA_CERT_PATH`, `ARCA_KEY_PATH` — rutas al certificado y clave.
- `ARCA_CUIT` — CUIT contribuyente (requerido para WSFE Auth; dígitos, sin obligar guiones en `.env`).
- `ARCA_WSFEV1_URL_DEV` — URL SOAP WSFEv1 homo (p. ej. `…/wsfev1/service.asmx`).
- `ARCA_WSAA_SERVICE` — servicio destino (p. ej. `wsfe`); por defecto `wsfe`.

## Próximos pasos sugeridos

1. Quitar el log temporal del XML completo de `FECAESolicitar` antes de producción (expone token/sign en cuerpo SOAP).
2. Probar en homo `GET /arca/wsfe/last-voucher` y `POST /arca/wsfe/create-voucher` tras el fix de `FECompUltimoAutorizado`.
3. Probar homologación: reinicio del proceso debe rehidratar TA desde `tmp/ta.json` si sigue válido.
4. Proteger o desactivar `GET /arca/wsaa/login` en producción (sin auth expone TA).
5. Arreglar el build TypeScript previo (`src/mastra/*`, Mastra opcional vs build).

## Notas

- WSAA homo puede devolver **HTTP 500** con SOAP `Fault` en el cuerpo (p. ej. `coe.alreadyAuthenticated`); el cliente axios acepta cualquier status y parsea el XML.
