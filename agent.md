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
- Dependencias añadidas: `axios`, `fast-xml-parser`, **`playwright`**, **`qrcode`** (PDF comprobantes).
- **Ruta** `POST /pdf/invoice` — body JSON validado con Zod (`invoicePdfBodySchema` en `src/pdf/invoice-models.ts`); genera PDF en **`tmp/invoices/{cuit11}_{cbteTipo}_{ptoVta}_{numero}.pdf`** vía HTML + **Playwright** (`src/pdf/invoice-template.ts`, `src/pdf/invoice-pdf.ts`); intenta **Chromium bundleado**, luego canal **Chrome / Edge** instalado; opcional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; si nada funciona **503** (`PlaywrightPdfSetupError`). **`renderInvoicePdfBuffer`** para otros endpoints; QR AFIP `https://www.afip.gob.ar/fe/qr/?p=` + base64url del JSON (ver, fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda, ctz, tipoDocRec, nroDocRec, tipoCodAut **E**, codAut). Respuesta `{ ok, path, filename }`.
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
- **Ruta** `GET /arca/wsfe/voucher-pdf` — obligatorios `ptoVta`, `cbteTipo`, `cbteNro`; `FECompConsultar` + plantilla tipo Comprobantes en línea (**`invoice-template.ts`**); query opcional: metadatos comerciales (`issuerName`, `issuerAddress`, `receiverName`, `receiverAddress`, `saleCondition`, `serviceFrom`, `serviceTo`, `paymentDueDate`, `itemDescription`, `copies`, etc.; ver `parseVoucherPdfQueryMetadata` en `src/pdf/invoice-pdf-merge.ts`). **`copies`**: omitido/`original` → solo ORIGINAL; `all` → tres copias; lista separada por coma. Respuesta **`application/pdf`**.
- **Ruta** `POST /arca/wsfe/voucher-pdf` — mismo flujo fiscal (`FECompConsultar` obligatorio por `ptoVta`/`cbteTipo`/`cbteNro`); body **`voucherPdfPostBodySchema`**: fusión campo a campo sobre el payload FE en `mergeVoucherPdfPostIntoPayload` (issuer/receiver/`voucherExtra`/`items`; strings vacíos no pisan; CUIT del body solo si hay ≥11 dígitos). Antes de Playwright: log **`[pdf] merged invoice data`** con el JSON fusionado (`console.log`). Totales y CAE siguen del `ResultGet`.
- **PDF comprobante** (`src/pdf/invoice-template.ts`): página **210×297 mm**, márgenes **~22 mm** arriba y **14 mm** lados en `.page`; marco `#333`; banda **ORIGINAL** dentro del borde exterior; cabecera ~**160 px** (emisión con nombre centrado y filas con etiquetas negritas, sello **78×88 px**, **COD.** estilo línea tipo ARCA según clase A/B dos dígitos o C/`cbteTipo` ≥ **11** tres dígitos); período en **rejilla 6 columnas**; receptor en **dos columnas**; tabla con hueco superior, **`Alícuota IVA`** y columnas solicitadas Factura **A**; pie totales / QR / **CAE** / **«Pág.»** centrado.
- **Ruta** `POST /arca/wsfe/create-voucher` — `FECAESolicitar` homo; body Zod (+ regla anterior); respuesta `observations: string[]`; `ok` solo si CAE informado y `result === "A"` (caso rechazo observable sin CAE, p. ej. `R`, `ok=false` con observaciones en el payload).
- Carga de `.env` al arrancar el servidor (`import "dotenv/config"` en `src/server.ts`).
- **Mastra eliminado** del proyecto: dependencia `@mastra/core` desinstalada (`npm uninstall @mastra/core`) y carpeta `src/mastra/` borrada (no integraba rutas AFIP).
- Build **TypeScript**: `isConsultarSkippedNotFound` usa el grupo de regex con comprobación explícita (`codeStr`), `GET /arca/wsfe/vouchers` arma el objeto para `listWsfeVouchers` sin pasar propiedades `undefined` (**`exactOptionalPropertyTypes`**), devDependency **`@types/qrcode`** para imports de `qrcode`.

## Variables de entorno esperadas

Definir variables en **`.env` en la raíz del repo** (cargado al arrancar con `dotenv/config`). Guía de llamadas HTTP con `curl`: **`SERVICIOS-API.md`** en la raíz del repo.

- `ARCA_WSAA_URL_DEV` — endpoint WSAA homo.
- `ARCA_CERT_PATH`, `ARCA_KEY_PATH` — rutas al certificado y clave.
- `ARCA_CUIT` — CUIT contribuyente (requerido para WSFE Auth y para PDF consultado; dígitos, sin obligar guiones en `.env`).
- Opcional PDF emisor (**`GET/POST /arca/wsfe/voucher-pdf`**, query o body, y **`POST /pdf/invoice`**): `ARCA_PDF_ISSUER_NAME`, `ARCA_PDF_ISSUER_IVA_CONDITION`, `ARCA_PDF_ISSUER_ADDRESS`, `ARCA_PDF_ISSUER_IIBB`, `ARCA_PDF_ISSUER_ACTIVITY_START`, `ARCA_PDF_CBU`, `ARCA_PDF_LINE_DESCRIPTION`.
- `ARCA_WSFEV1_URL_DEV` — URL SOAP WSFEv1 homo (p. ej. `…/wsfev1/service.asmx`).
- `ARCA_WSAA_SERVICE` — servicio destino (p. ej. `wsfe`); por defecto `wsfe`.
- **PDF (Playwright):** sin binarios responde **503** con instrucciones. Instalación típica: `npx playwright install chromium`. Si tenés **Google Chrome** o **Edge** instalado, el backend intenta usarlo automáticamente. Opcional: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — ruta al ejecutable.

## Próximos pasos sugeridos

1. Documentar más ejemplos de query `GET …/voucher-pdf` (copias + receptor).
2. Quitar el log temporal del XML completo de `FECAESolicitar` antes de producción (expone token/sign en cuerpo SOAP).
3. Probar en homo `GET /arca/wsfe/last-voucher` y `POST /arca/wsfe/create-voucher` tras el fix de `FECompUltimoAutorizado`.
4. Probar homologación: reinicio del proceso debe rehidratar TA desde `tmp/ta.json` si sigue válido.
5. Proteger o desactivar `GET /arca/wsaa/login` en producción (sin auth expone TA).

## Notas

- WSAA homo puede devolver **HTTP 500** con SOAP `Fault` en el cuerpo (p. ej. `coe.alreadyAuthenticated`); el cliente axios acepta cualquier status y parsea el XML.
