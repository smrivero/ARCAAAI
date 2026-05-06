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
- Carga de `.env` al arrancar el servidor (`import "dotenv/config"` en `src/server.ts`).

## Variables de entorno esperadas

Definir variables en **`.env` en la raíz del repo** (cargado al arrancar con `dotenv/config`).

- `ARCA_WSAA_URL_DEV` — endpoint WSAA homo.
- `ARCA_CERT_PATH`, `ARCA_KEY_PATH` — rutas al certificado y clave.
- `ARCA_CUIT` — opcional para logs.
- `ARCA_WSAA_SERVICE` — servicio destino (p. ej. `wsfe`); por defecto `wsfe`.

## Próximos pasos sugeridos

1. Probar homologación: reinicio del proceso debe rehidratar TA desde `tmp/ta.json` si sigue válido.
2. Proteger o desactivar `GET /arca/wsaa/login` en producción (sin auth expone TA).
3. Arreglar el build TypeScript previo (`src/mastra/*`, Mastra opcional vs build).

## Notas

- WSAA homo puede devolver **HTTP 500** con SOAP `Fault` en el cuerpo (p. ej. `coe.alreadyAuthenticated`); el cliente axios acepta cualquier status y parsea el XML.
