# arca-agent

Backend **Fastify** para integración **WSAA / WSFEv1** (homologación) y generación de **PDF** de comprobantes con layout inspirado en **Comprobantes en línea (ARCA / AFIP)**.

Servicios HTTP y ejemplos `curl`: **[`SERVICIOS-API.md`](./SERVICIOS-API.md)**.

## Requisitos

- Node.js 20+
- Variables en `.env` (ver `agent.md` en el repo)
- Para PDF: `npx playwright install chromium` o Chrome/Edge instalado

## Arranque

```bash
npm install
npm run build
npm start
```

Por defecto escucha en el puerto **3000** (`PORT` en `.env`).

## PDF de comprobante (WSFE consultado)

- **GET** `/arca/wsfe/voucher-pdf?ptoVta=…&cbteTipo=…&cbteNro=…`  
  Datos fiscales desde **`FECompConsultar`**. Query opcional para datos comerciales (nombre/domicilio receptor, períodos, copias, etc.):  
  `issuerName`, `issuerAddress`, `receiverName`, `receiverAddress`, `saleCondition`, `serviceFrom`, `serviceTo`, `paymentDueDate`, `itemDescription`, `copies` (`original` | `all` | `original,duplicado`, …).

- **POST** `/arca/wsfe/voucher-pdf`  
  Mismo origen fiscal (consulta WSFE obligatoria por número de comprobante), con cuerpo JSON para **enriquecer** emisor, receptor, plazos, ítems y copias sin depender solo de FE.

### Ejemplo POST (factura autorizada debe existir en homo para ese número)

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

**Nota:** `ptoVta`, `cbteTipo` y `cbteNro` deben corresponder a un comprobante real devuelto por AFIP (`FECompConsultar`). CAE, importes totales y QR siguen basados en la respuesta de consulta; el cuerpo del POST solo **complementa** la presentación comercial del PDF.

En **Factura A**, las columnas **Alicuota IVA** y **Subtotal c/IVA** se muestran vacías o como “—” si no enviás `alicuotaIva` / `subtotalWithIva` por ítem; para alinearlas con el fiscal, agregalos al JSON (por ejemplo `21%` y el subtotal con IVA de la línea).
