# Servicios HTTP del backend (arca-agent)

Base URL por defecto: `http://localhost:3000` (configurable con `PORT` en `.env`).

Requisitos típicos para AFIP/WSFE:

- `.env` con certificados, CUIT, URLs de homologación, etc. (ver `agent.md`).
- Para respuestas PDF: Playwright/Chromium o Chrome/Edge instalado.

---

## Salud

### `GET /health`

Comprueba que el proceso responde.

```bash
curl -s "http://localhost:3000/health" | jq .
```

Respuesta ejemplo: `{ "ok": true, "service": "arca-agent", "timestamp": "..." }`.

---

## ARCA (`/arca`)

### `GET /arca/ping`

Indicador simple de modo homologación.

```bash
curl -s "http://localhost:3000/arca/ping" | jq .
```

---

### `GET /arca/wsaa/login`

**Solo desarrollo / pruebas.** Obtiene token y sign desde WSAA (o error si AFIP marca TA válido pero no hay `tmp/ta.json` usable).

```bash
curl -s "http://localhost:3000/arca/wsaa/login" | jq .
```

---

### `GET /arca/wsfe/last-voucher`

Último comprobante autorizado (`FECompUltimoAutorizado`).

Query (opcional con defaults del código): `ptoVta`, `cbteTipo`.

```bash
curl -s "http://localhost:3000/arca/wsfe/last-voucher?ptoVta=1&cbteTipo=6" | jq .
```

---

### `GET /arca/wsfe/vouchers`

Listado recorriendo números hacia atrás con `FECompConsultar`.

Query obligatorios: `ptoVta`, `cbteTipo`.

Opcional: `limit` (1–100), `fromDate`, `toDate` (formato `yyyymmdd`).

```bash
curl -s "http://localhost:3000/arca/wsfe/vouchers?ptoVta=3&cbteTipo=1&limit=10" | jq .
```

---

### `GET /arca/wsfe/voucher-pdf`

PDF del comprobante consultado (`FECompConsultar`) + layout tipo comprobante en línea.

Query obligatorios: `ptoVta`, `cbteTipo`, `cbteNro`.

Opcional — datos comerciales (no vienen todos en FE): por ejemplo  
`issuerName`, `issuerAddress`, `issuerIvaCondition`, `issuerIibb`, `issuerActivityStartDate`,  
`receiverName`, `receiverAddress`, `receiverIvaCondition`,  
`saleCondition`, `serviceFrom`, `serviceTo`, `paymentDueDate`, `itemDescription`,  
y `copies` (`original` | `all` | `original,duplicado`, …).  
Las mismas claves pueden usarse en **snake_case** (`receiver_name`, etc.).

```bash
curl -s \
  -o factura.pdf \
  "http://localhost:3000/arca/wsfe/voucher-pdf?ptoVta=3&cbteTipo=1&cbteNro=153&copies=original"

curl -s \
  -o facturas-triple.pdf \
  "http://localhost:3000/arca/wsfe/voucher-pdf?ptoVta=3&cbteTipo=1&cbteNro=153&copies=all&receiverName=ACRONS%20SRL"
```

Respuesta: `application/pdf` (`Content-Disposition: inline`).

---

### `POST /arca/wsfe/voucher-pdf`

Igual que el GET pero el cuerpo JSON **enriquece** emisor, receptor, plazos, ítems y copias después de consultar WSFE por `ptoVta` / `cbteTipo` / `cbteNro`. Los **totales**, **CAE** y datos fiscales del comprobante siguen saliendo de **`FECompConsultar`** (no se arma el QR solo desde el body).

Campos opcionales: `copies`, `issuer`, `receiver`, `voucherExtra`, `items`.

Antes del renderizado el servidor registra el payload fusionado en consola:  
`[pdf] merged invoice data ...`

```bash
curl -X POST "http://localhost:3000/arca/wsfe/voucher-pdf" \
  -H "Content-Type: application/json" \
  -o factura-a.pdf \
  -d '{
    "ptoVta": 1,
    "cbteTipo": 1,
    "cbteNro": 1,
    "copies": ["ORIGINAL"],
    "issuer": {
      "name": "RIVERO BAYONA SEBASTIAN MATIAS",
      "cuit": "20940829268",
      "address": "Olivos, Buenos Aires",
      "ivaCondition": "IVA Responsable Inscripto",
      "iibb": "—",
      "activityStartDate": "01/01/2026"
    },
    "receiver": {
      "name": "ACRONS SRL",
      "cuit": "30714671843",
      "ivaCondition": "IVA Responsable Inscripto",
      "address": "Butty Enrique Ing. 240 Piso 5 - CABA"
    },
    "voucherExtra": {
      "saleCondition": "Contado",
      "serviceFrom": "06/05/2026",
      "serviceTo": "06/05/2026",
      "paymentDueDate": "06/05/2026"
    },
    "items": [
      {
        "code": "5",
        "description": "Servicio profesional de desarrollo de software",
        "quantity": 1,
        "unit": "unidades",
        "unitPrice": 1000,
        "discountPercent": 0,
        "discountAmount": 0,
        "subtotal": 1000
      }
    ]
  }'
```

**Importante:** `ptoVta`, `cbteTipo` y `cbteNro` deben existir en AFIP para ese contribuyente. En **Factura A**, si necesitás que columnas de IVA cuadren con el fiscal, podés enviar por ítem `alicuotaIva` y `subtotalWithIva`.

Copias PDF: `"copies": ["ORIGINAL", "DUPLICADO", "TRIPLICADO"]`.

---

### `POST /arca/wsfe/create-voucher`

Emisión mínima vía **`FECAESolicitar`** (homologación). Cuerpo validado por Zod (`createVoucherBodySchema`).

Campos típicos: `ptoVta`, `cbteTipo`, `concepto`, `docTipo`, `docNro`, `impTotal`, `impNeto`, `impIVA`, `monId`, `monCotiz`, `iva[]` (`id`, `baseImp`, `importe`), opcional `condicionIVAReceptorId` (salvo consumidor final `docTipo === 99`, donde puede omitirse).

```bash
curl -s -X POST "http://localhost:3000/arca/wsfe/create-voucher" \
  -H "Content-Type: application/json" \
  -d '{
    "ptoVta": 1,
    "cbteTipo": 6,
    "concepto": 1,
    "docTipo": 96,
    "docNro": 12345678,
    "impTotal": 1210,
    "impNeto": 1000,
    "impIVA": 210,
    "monId": "PES",
    "monCotiz": 1,
    "iva": [{"id": 5, "baseImp": 1000, "importe": 210}],
    "condicionIVAReceptorId": 5
  }' | jq .
```

Adaptá montos y `docTipo`/`docNro` a tu caso y al ambiente homo.

---

## PDF standalone (`/pdf`)

### `POST /pdf/invoice`

Genera un PDF desde un **payload completo** (sin llamar WSFE). Guarda en `tmp/invoices/` y devuelve JSON con `path` y `filename`. El schema es **`invoicePdfBodySchema`** (`copyTypes`, `issuer`, `receiver`, `voucher`, `items`, `totals`, etc.) — ver `src/pdf/invoice-models.ts`.

```bash
curl -s -X POST "http://localhost:3000/pdf/invoice" \
  -H "Content-Type: application/json" \
  -d @ruta/al/payload-completo.json | jq .
```

---

## Resumen rápido

| Método | Ruta | Descripción breve |
|--------|------|-------------------|
| GET | `/health` | Estado del servicio |
| GET | `/arca/ping` | Ping ARCA/homo |
| GET | `/arca/wsaa/login` | Login WSAA (pruebas) |
| GET | `/arca/wsfe/last-voucher` | Último número autorizado |
| GET | `/arca/wsfe/vouchers` | Lista comprobantes hacia atrás |
| GET | `/arca/wsfe/voucher-pdf` | PDF desde consulta FE + query opcional |
| POST | `/arca/wsfe/voucher-pdf` | PDF desde consulta FE + body JSON opcional |
| POST | `/arca/wsfe/create-voucher` | Emitir con `FECAESolicitar` |
| POST | `/pdf/invoice` | PDF sólo desde JSON completo → disco |
