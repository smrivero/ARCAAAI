import type { InvoicePdfPayload } from "./invoice-models.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Formato numérico argentino habitual (punto miles, coma decimales). */
export function formatArAmount(n: number): string {
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildInvoiceHtml(data: InvoicePdfPayload, qrDataUrl: string): string {
  const ptoFmt = String(data.voucher.ptoVta).padStart(5, "0");
  const nroFmt = String(data.voucher.number).padStart(8, "0");
  const tipoLine = `${escapeHtml(data.voucher.letter)} ${escapeHtml(data.voucher.typeName)}`.trim();

  const copyPages = data.copyTypes
    .map((copyLabel, idx) =>
      renderCopyPage({
        copyLabel,
        copyIndex: idx + 1,
        totalCopies: data.copyTypes.length,
        data,
        qrDataUrl,
        ptoFmt,
        nroFmt,
        tipoLine,
      }),
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Comprobante</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10pt;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      page-break-after: always;
      padding: 0;
    }
    .sheet:last-child { page-break-after: auto; }
    .copy-ribbon {
      text-align: center;
      font-weight: bold;
      font-size: 11pt;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
      border: 2px solid #000;
      padding: 4px 8px;
    }
    .letter-big {
      text-align: center;
      font-size: 72pt;
      font-weight: bold;
      line-height: 0.85;
      margin: 0 0 4px 0;
    }
    .cod-row {
      text-align: center;
      font-weight: bold;
      font-size: 11pt;
      margin-bottom: 2px;
    }
    .tipo-row {
      text-align: center;
      font-size: 14pt;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 10px;
      font-size: 9pt;
    }
    .meta-block {
      flex: 1;
      border: 1px solid #000;
      padding: 6px 8px;
      min-height: 120px;
    }
    .meta-block h3 {
      margin: 0 0 6px 0;
      font-size: 10pt;
      border-bottom: 1px solid #000;
      padding-bottom: 2px;
    }
    .kv { margin: 2px 0; }
    .details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 16px;
      border: 1px solid #000;
      padding: 6px 8px;
      margin-bottom: 10px;
      font-size: 9pt;
    }
    .details-grid div { overflow: hidden; }
    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      font-size: 9pt;
    }
    table.items th, table.items td {
      border: 1px solid #000;
      padding: 4px 5px;
      text-align: left;
    }
    table.items th { background: #f0f0f0; font-weight: bold; }
    table.items .num { text-align: right; white-space: nowrap; }
    .totals-wrap {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 10px;
    }
    table.totals {
      border-collapse: collapse;
      font-size: 10pt;
    }
    table.totals td {
      border: 1px solid #000;
      padding: 4px 10px;
    }
    table.totals td:first-child { font-weight: bold; }
    table.totals td:last-child { text-align: right; min-width: 110px; }
    .cae-qr-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
      margin-top: 12px;
      margin-bottom: 10px;
    }
    .cae-block {
      font-size: 10pt;
      flex: 1;
    }
    .cae-block .line { margin: 3px 0; }
    .qr-wrap { flex-shrink: 0; text-align: center; }
    .qr-wrap img { width: 120px; height: 120px; display: block; }
    .footer {
      border-top: 1px solid #000;
      margin-top: 10px;
      padding-top: 6px;
      font-size: 8pt;
      text-align: center;
      line-height: 1.35;
    }
    .pagina {
      text-align: right;
      font-size: 8pt;
      margin-top: 6px;
    }
  </style>
</head>
<body>${copyPages}</body>
</html>`;
}

function renderCopyPage(opts: {
  copyLabel: string;
  copyIndex: number;
  totalCopies: number;
  data: InvoicePdfPayload;
  qrDataUrl: string;
  ptoFmt: string;
  nroFmt: string;
  tipoLine: string;
}): string {
  const { copyLabel, copyIndex, totalCopies, data, qrDataUrl, ptoFmt, nroFmt, tipoLine } = opts;
  const iss = data.issuer;
  const rec = data.receiver;
  const v = data.voucher;

  const itemsRows = data.items
    .map(
      (it) =>
        `<tr>
          <td>${escapeHtml(it.description)}</td>
          <td class="num">${formatArAmount(it.quantity)}</td>
          <td>${escapeHtml(it.unit)}</td>
          <td class="num">${formatArAmount(it.unitPrice)}</td>
          <td class="num">${formatArAmount(it.discountPercent)}</td>
          <td class="num">${formatArAmount(it.discountAmount)}</td>
          <td class="num">${formatArAmount(it.subtotal)}</td>
        </tr>`,
    )
    .join("");

  const iibb =
    iss.iibb !== undefined && iss.iibb.trim() !== "" ? `<div class="kv">IIBB: ${escapeHtml(iss.iibb)}</div>` : "";
  const act =
    iss.activityStartDate !== undefined && iss.activityStartDate.trim() !== ""
      ? `<div class="kv">Inicio actividades: ${escapeHtml(iss.activityStartDate)}</div>`
      : "";

  const recCuit =
    rec.cuit !== undefined && rec.cuit.trim() !== ""
      ? `<div class="kv">CUIT: ${escapeHtml(rec.cuit)}</div>`
      : "";

  return `<section class="sheet">
    <div class="copy-ribbon">${escapeHtml(copyLabel)}</div>
    <div class="letter-big">${escapeHtml(v.letter)}</div>
    <div class="cod-row">COD. ${escapeHtml(v.code)}</div>
    <div class="tipo-row">${tipoLine}</div>

    <div class="meta-row">
      <div class="meta-block">
        <h3>Emitido por</h3>
        <div class="kv"><strong>${escapeHtml(iss.name)}</strong></div>
        <div class="kv">CUIT: ${escapeHtml(iss.cuit)}</div>
        <div class="kv">${escapeHtml(iss.address)}</div>
        <div class="kv">${escapeHtml(iss.ivaCondition)}</div>
        ${iibb}${act}
      </div>
      <div class="meta-block">
        <h3>Receptor</h3>
        <div class="kv"><strong>${escapeHtml(rec.name)}</strong></div>
        ${recCuit}
        <div class="kv">${escapeHtml(rec.address)}</div>
        <div class="kv">${escapeHtml(rec.ivaCondition)}</div>
      </div>
    </div>

    <div class="details-grid">
      <div>Punto de venta: <strong>${escapeHtml(ptoFmt)}</strong></div>
      <div>Número: <strong>${escapeHtml(nroFmt)}</strong></div>
      <div>Fecha emisión: <strong>${escapeHtml(v.issueDate)}</strong></div>
      <div>Condición venta: <strong>${escapeHtml(v.saleCondition)}</strong></div>
      <div>Periodo desde: ${escapeHtml(v.serviceFrom)}</div>
      <div>Periodo hasta: ${escapeHtml(v.serviceTo)}</div>
      <div style="grid-column: 1 / -1;">Vencimiento pago: <strong>${escapeHtml(v.paymentDueDate)}</strong></div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Descripción</th>
          <th class="num">Cantidad</th>
          <th>Unidad</th>
          <th class="num">P. unitario</th>
          <th class="num">% Desc.</th>
          <th class="num">Desc. $</th>
          <th class="num">Subtotal</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>

    <div class="totals-wrap">
      <table class="totals">
        <tbody>
          <tr><td>Subtotal</td><td>${formatArAmount(data.totals.subtotal)}</td></tr>
          <tr><td>Otros tributos</td><td>${formatArAmount(data.totals.otherTaxes)}</td></tr>
          <tr><td>Total</td><td>${formatArAmount(data.totals.total)}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="cae-qr-row">
      <div class="cae-block">
        <div class="line"><strong>CAE N°:</strong> ${escapeHtml(v.cae)}</div>
        <div class="line"><strong>Vto. CAE:</strong> ${escapeHtml(v.caeDueDate)}</div>
      </div>
      <div class="qr-wrap">
        <img src="${qrDataUrl}" alt="QR AFIP" width="120" height="120" />
      </div>
    </div>

    <div class="footer">
      <div><strong>Comprobante Autorizado</strong></div>
      <div>Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación</div>
    </div>
    <div class="pagina">Pág. ${copyIndex}/${totalCopies}</div>
  </section>`;
}
