function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function onlyDigits(s) {
    return s.replace(/\D/g, "");
}
/** CUIT argentino XX-XXXXXXXX-X */
export function formatCuitDisplay(raw) {
    const d = onlyDigits(raw);
    if (d.length !== 11) {
        return escapeHtml(raw.trim());
    }
    return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}
/** Montos estilo ARCA: coma decimal, sin separador de miles. */
export function formatArAmountCompact(n) {
    const [intRaw, frac] = Number.isFinite(n) ? n.toFixed(2).split(".") : ["0", "00"];
    return `${intRaw},${frac}`;
}
export function formatArAmount(n) {
    return formatArAmountCompact(n);
}
const CANON_IVA_LABELS = [
    "IVA 27%",
    "IVA 21%",
    "IVA 10.5%",
    "IVA 5%",
    "IVA 2.5%",
    "IVA 0%",
];
function resolveCbteTipoForDisplay(v) {
    if (v.cbteTipo !== undefined) {
        return v.cbteTipo;
    }
    const p = Number.parseInt(v.code, 10);
    return Number.isFinite(p) ? p : 0;
}
/**
 * COD. junto al sello tipo ARCA Comprobantes en línea:
 * letra/categoría B → 2 dígitos (ej. Factura B 06), C y similares → 3 (ej. 011).
 */
function stampCodAfipLike(v) {
    const t = resolveCbteTipoForDisplay(v);
    if (v.letter === "C" || t >= 11) {
        return String(t).padStart(3, "0");
    }
    return String(t).padStart(2, "0");
}
function isFacturaTipoALetter(v) {
    if (v.letter === "A") {
        return true;
    }
    const t = resolveCbteTipoForDisplay(v);
    return t === 1 || t === 2 || t === 3;
}
function resolveIvaRowsForTotals(totals) {
    if (totals.ivaLines !== undefined && totals.ivaLines.length > 0) {
        const map = new Map(totals.ivaLines.map((r) => [r.label, r.amount]));
        return CANON_IVA_LABELS.map((label) => ({
            label,
            amount: map.get(label) ?? 0,
        }));
    }
    const neto = totals.importeNetoGravado ?? totals.subtotal;
    const impl = Math.max(0, totals.total - neto - totals.otherTaxes);
    return CANON_IVA_LABELS.map((label, idx) => idx === 1 ? { label, amount: impl } : { label, amount: 0 });
}
function lineSubtotalConIva(it) {
    if (it.subtotalWithIva !== undefined) {
        return it.subtotalWithIva;
    }
    return it.subtotal;
}
function buildItemsRows(items, showIva) {
    const itemCode = (it) => it.code !== undefined && it.code.trim() !== "" ? escapeHtml(it.code.trim()) : "—";
    const itemAlic = (it) => it.alicuotaIva !== undefined && it.alicuotaIva.trim() !== ""
        ? escapeHtml(it.alicuotaIva.trim())
        : "—";
    return items
        .map((it) => {
        const core = `<tr>
          <td class="c-code">${itemCode(it)}</td>
          <td class="c-desc">${escapeHtml(it.description)}</td>
          <td class="num">${formatArAmountCompact(it.quantity)}</td>
          <td class="c-unit">${escapeHtml(it.unit)}</td>
          <td class="num">${formatArAmountCompact(it.unitPrice)}</td>
          <td class="num">${formatArAmountCompact(it.discountPercent)}</td>
          <td class="num">${formatArAmountCompact(it.discountAmount)}</td>
          <td class="num">${formatArAmountCompact(it.subtotal)}</td>`;
        const ivaCols = showIva
            ? `
          <td class="c-alic">${itemAlic(it)}</td>
          <td class="num">${formatArAmountCompact(lineSubtotalConIva(it))}</td>`
            : "";
        return `${core}${ivaCols}</tr>`;
    })
        .join("");
}
export function buildInvoiceHtml(data, qrDataUrl) {
    const showIvaCols = isFacturaTipoALetter(data.voucher);
    const stampCod = stampCodAfipLike(data.voucher);
    const ptoFmt = String(data.voucher.ptoVta).padStart(5, "0");
    const nroFmt = String(data.voucher.number).padStart(8, "0");
    const iss = data.issuer;
    const rec = data.receiver;
    const v = data.voucher;
    const iibbLine = iss.iibb !== undefined && iss.iibb.trim() !== ""
        ? `<div class="hdr-field"><span class="lbl">Ingresos Brutos:</span> ${escapeHtml(iss.iibb.trim())}</div>`
        : "";
    const actLine = iss.activityStartDate !== undefined && iss.activityStartDate.trim() !== ""
        ? `<div class="hdr-field"><span class="lbl">Fecha de Inicio de Actividades:</span> ${escapeHtml(iss.activityStartDate.trim())}</div>`
        : "";
    const itemsRows = buildItemsRows(data.items, showIvaCols);
    const netoGravado = data.totals.importeNetoGravado ?? data.totals.subtotal;
    const ivaRowsRaw = resolveIvaRowsForTotals(data.totals);
    let totalsRightInner;
    if (showIvaCols) {
        totalsRightInner = `
        <div class="tot-line"><span>Importe Neto Gravado:</span><span class="money">$ ${formatArAmountCompact(netoGravado)}</span></div>
        ${ivaRowsRaw
            .map((r) => `<div class="tot-line"><span>${escapeHtml(r.label)}:</span><span class="money">$ ${formatArAmountCompact(r.amount)}</span></div>`)
            .join("")}
        <div class="tot-line"><span>Importe Otros Tributos:</span><span class="money">$ ${formatArAmountCompact(data.totals.otherTaxes)}</span></div>
        <div class="tot-line total-final"><span>Importe Total:</span><span class="money">$ ${formatArAmountCompact(data.totals.total)}</span></div>`;
    }
    else {
        totalsRightInner = `
        <div class="tot-line"><span>Importe Neto Gravado:</span><span class="money">$ ${formatArAmountCompact(netoGravado)}</span></div>
        <div class="tot-line"><span>Importe Otros Tributos:</span><span class="money">$ ${formatArAmountCompact(data.totals.otherTaxes)}</span></div>
        <div class="tot-line total-final"><span>Importe Total:</span><span class="money">$ ${formatArAmountCompact(data.totals.total)}</span></div>`;
    }
    const cbuBlock = v.cbu !== undefined && v.cbu.trim() !== ""
        ? `<div class="cbu-line">C.B.U.: ${escapeHtml(v.cbu.trim())}</div>`
        : "";
    const theadIva = showIvaCols
        ? `<th>Al&#237;cuota IVA</th><th>Subtotal c/IVA</th>`
        : "";
    const receiverCuitDisplay = rec.cuit !== undefined && rec.cuit.trim() !== "" ? formatCuitDisplay(rec.cuit) : "—";
    const copyPages = data.copyTypes
        .map((copyLabel, idx) => renderArcaCopyPage({
        copyLabel,
        copyIndex: idx + 1,
        totalCopies: data.copyTypes.length,
        data,
        qrDataUrl,
        ptoFmt,
        nroFmt,
        stampCod,
        issuer: iss,
        receiver: rec,
        voucher: v,
        receiverCuitDisplay,
        iibbLine,
        actLine,
        itemsRows,
        totalsRightInner,
        cbuBlock,
        theadIva,
    }))
        .join("\n");
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Comprobante</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      color: #111;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* Hoja A4 con márgenes (~22 mm arriba, ~14 mm lados según modelo ARCA) */
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 22mm 14mm 12mm 14mm;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
    }

    .sheet {
      page-break-after: always;
    }
    .sheet:last-child { page-break-after: auto; }

    .invoice-sheet {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: calc(297mm - 34mm);
      max-width: 100%;
      border: 1px solid #333;
      overflow: hidden;
    }

    .copy-band {
      text-align: center;
      font-weight: bold;
      font-size: 11px;
      letter-spacing: 0.2em;
      padding: 5px 8px;
      border-bottom: 1px solid #333;
      background: #fff;
    }

    /* Cabecera: ~160px alto, tres columnas (emisión | sello | comprobante) */
    .header-frame {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 78px minmax(0, 1fr);
      grid-template-rows: minmax(0, 160px);
      max-height: 160px;
      min-height: 160px;
      border-bottom: 1px solid #333;
      align-items: stretch;
    }

    .header-left {
      padding: 6px 10px 8px 10px;
      border-right: 1px solid #333;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
    }

    /* Nombre fantasía centrado, sin segunda línea gigante repetida debajo */
    .issuer-trade {
      font-size: 12px;
      font-weight: bold;
      text-align: center;
      margin-bottom: 6px;
      line-height: 1.25;
      word-break: break-word;
    }

    .issuer-fields .hdr-field {
      margin: 2px 0;
      font-size: 11px;
      text-align: left;
    }

    .header-left .hdr-field .lbl,
    .hdr-field .lbl {
      font-weight: bold;
      margin-right: 4px;
    }

    /* Sello letra tipo ARCA — caja compacta centrada sobre el cruce vertical */
    .header-stamp {
      border-right: 1px solid #333;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 78px;
      min-width: 78px;
      max-width: 78px;
      height: 88px;
      min-height: 88px;
      max-height: 88px;
      align-self: center;
      justify-self: center;
      margin: auto 0;
      padding: 2px;
    }

    .stamp-letter {
      font-size: 54px;
      font-weight: bold;
      line-height: 0.88;
      text-align: center;
    }

    .stamp-cod {
      font-size: 10px;
      font-weight: bold;
      margin-top: 4px;
      text-align: center;
    }

    .header-right {
      padding: 8px 10px 10px 10px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
    }

    .tipo-title {
      font-size: 19px;
      font-weight: bold;
      letter-spacing: 0.02em;
      margin-bottom: 6px;
      line-height: 1.1;
    }

    .header-right .hdr-field {
      margin: 2px 0;
      font-size: 11px;
      line-height: 1.3;
      text-align: left;
      word-break: break-word;
    }

    /* Período: 6 celdas (etiqueta/valor)×3 sin recortes */
    .band-period {
      display: grid;
      grid-template-columns:
        max-content minmax(52px, 1fr)
        max-content minmax(52px, 1fr)
        max-content minmax(0, 1.2fr);
      column-gap: 6px;
      row-gap: 4px;
      align-items: center;
      padding: 6px 10px;
      min-height: 34px;
      font-size: 11px;
      border-bottom: 1px solid #333;
      background: #fff;
    }

    .band-period .p-lbl {
      font-weight: bold;
      white-space: nowrap;
    }

    .band-period .p-val {
      white-space: nowrap;
      overflow: visible;
      min-width: 0;
      text-overflow: clip;
      font-weight: normal;
    }

    /* Receptor compacto dos columnas */
    .receiver-box {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 16px;
      row-gap: 4px;
      padding: 5px 10px 7px 10px;
      min-height: 90px;
      font-size: 11px;
      border-bottom: 1px solid #333;
      align-content: center;
      min-width: 0;
    }

    .rx-col {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .rx-row {
      line-height: 1.35;
      min-width: 0;
      word-break: break-word;
    }

    .rx-row .lbl {
      font-weight: bold;
      margin-right: 4px;
    }

    .rx-val {
      font-weight: normal;
    }

    .table-wrap {
      flex: 1 1 auto;
      min-height: 24px;
      margin-top: 8px;
      padding: 0 0 8px;
      overflow: visible;
      min-width: 0;
    }

    table.items {
      width: 100%;
      max-width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      table-layout: fixed;
    }

    table.items th,
    table.items td {
      border: 1px solid #333;
      padding: 2px 4px;
      vertical-align: middle;
    }

    table.items thead th {
      background: #d9d9d9;
      font-weight: bold;
      text-align: center;
      font-size: 10px;
      line-height: 1.15;
      padding: 3px 2px;
    }

    table.items tbody td {
      font-size: 11px;
      padding-top: 2px;
      padding-bottom: 2px;
      line-height: 1.2;
    }

    table.items .c-desc {
      text-align: left;
      overflow: hidden;
      word-break: break-word;
    }

    table.items .c-code {
      width: 8%;
      text-align: center;
    }

    table.items .c-unit {
      width: 8%;
      text-align: center;
    }

    table.items .c-alic {
      width: 7%;
      text-align: center;
    }

    table.items .num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      width: 8%;
    }

    .invoice-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
    }

    .bottom-stack {
      margin-top: auto;
      flex-shrink: 0;
    }

    .totals-frame {
      border-top: 1px solid #333;
      display: grid;
      grid-template-columns: 42% 1fr;
      min-height: auto;
      background: #fff;
    }

    .totals-left {
      border-right: 1px solid #333;
      padding: 8px 10px;
      font-size: 11px;
      align-self: stretch;
      display: flex;
      align-items: flex-start;
    }

    .totals-right {
      padding: 8px 10px;
      font-size: 11px;
      text-align: right;
    }

    .tot-line {
      display: flex;
      justify-content: flex-end;
      align-items: baseline;
      gap: 12px;
      margin: 1px 0;
    }

    .tot-line span:first-child {
      flex: 1 1 auto;
      text-align: right;
      min-width: 0;
      max-width: 70%;
    }

    .tot-line .money {
      font-variant-numeric: tabular-nums;
      min-width: 88px;
      text-align: right;
      flex-shrink: 0;
    }

    .tot-line.total-final {
      font-weight: bold;
      margin-top: 6px;
      padding-top: 4px;
      border-top: 1px solid #333;
    }

    .cbu-line {
      text-align: center;
      font-size: 11px;
      padding: 6px 8px 0;
    }

    .footer-block {
      border-top: 1px solid #333;
      padding: 8px 10px 4px;
    }

    .footer-main {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px;
    }

    .footer-l {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      flex: 0 0 auto;
    }

    .footer-l img {
      width: 92px;
      height: 92px;
      display: block;
    }

    .arca-mark { line-height: 1.15; }

    .arca-title {
      font-size: 16px;
      font-weight: bold;
      letter-spacing: 0.06em;
    }

    .arca-sub {
      font-size: 7.5px;
      max-width: 140px;
      color: #222;
      margin-top: 2px;
    }

    .footer-copy {
      flex: 1 1 auto;
      font-size: 7.5px;
      text-align: left;
      padding: 0 6px 2px;
      line-height: 1.35;
      min-width: 0;
    }

    .footer-copy strong {
      font-size: 9px;
      display: block;
      margin-bottom: 2px;
    }

    .footer-cae {
      text-align: right;
      font-size: 8.5px;
      white-space: nowrap;
      flex: 0 0 auto;
    }

    .footer-cae div { margin: 1px 0; }

    .pag-center {
      text-align: center;
      font-size: 8px;
      margin-top: 6px;
      padding-bottom: 2px;
    }
  </style>
</head>
<body>${copyPages}</body>
</html>`;
}
function renderArcaCopyPage(parts) {
    const { copyLabel, copyIndex, totalCopies, data, qrDataUrl, ptoFmt, nroFmt, stampCod, issuer: iss, receiver: rec, voucher: v, receiverCuitDisplay, iibbLine, actLine, itemsRows, totalsRightInner, cbuBlock, theadIva, } = parts;
    return `<section class="sheet">
  <div class="page">
    <div class="invoice-sheet">
      <div class="copy-band">${escapeHtml(copyLabel)}</div>

      <div class="header-frame">
        <div class="header-left">
          <div class="issuer-trade">${escapeHtml(iss.name)}</div>
          <div class="issuer-fields">
            <div class="hdr-field"><span class="lbl">Raz&#243;n Social:</span>${escapeHtml(iss.name)}</div>
            <div class="hdr-field"><span class="lbl">Domicilio Comercial:</span>${escapeHtml(iss.address)}</div>
            <div class="hdr-field"><span class="lbl">Condici&#243;n frente al IVA:</span>${escapeHtml(iss.ivaCondition)}</div>
          </div>
        </div>
        <div class="header-stamp">
          <div class="stamp-letter">${escapeHtml(v.letter)}</div>
          <div class="stamp-cod">COD. ${escapeHtml(stampCod)}</div>
        </div>
        <div class="header-right">
          <div class="tipo-title">${escapeHtml(v.typeName)}</div>
          <div class="hdr-field"><span class="lbl">Punto de Venta:</span> ${escapeHtml(ptoFmt)}</div>
          <div class="hdr-field"><span class="lbl">Comp. Nro:</span> ${escapeHtml(nroFmt)}</div>
          <div class="hdr-field"><span class="lbl">Fecha de Emisi&#243;n:</span> ${escapeHtml(v.issueDate)}</div>
          <div class="hdr-field"><span class="lbl">CUIT:</span> ${formatCuitDisplay(iss.cuit)}</div>
          ${iibbLine}
          ${actLine}
        </div>
      </div>

      <div class="band-period">
        <span class="p-lbl">Per&#237;odo Facturado Desde:</span>
        <span class="p-val">${escapeHtml(v.serviceFrom)}</span>
        <span class="p-lbl">Hasta:</span>
        <span class="p-val">${escapeHtml(v.serviceTo)}</span>
        <span class="p-lbl">Fecha de Vto. para el pago:</span>
        <span class="p-val">${escapeHtml(v.paymentDueDate)}</span>
      </div>

      <div class="receiver-box">
        <div class="rx-col rx-left">
          <div class="rx-row"><span class="lbl">CUIT:</span><span class="rx-val">${receiverCuitDisplay}</span></div>
          <div class="rx-row"><span class="lbl">Condici&#243;n frente al IVA:</span><span class="rx-val">${escapeHtml(rec.ivaCondition)}</span></div>
          <div class="rx-row"><span class="lbl">Condici&#243;n de venta:</span><span class="rx-val">${escapeHtml(v.saleCondition)}</span></div>
        </div>
        <div class="rx-col rx-right">
          <div class="rx-row"><span class="lbl">Apellido y Nombre / Raz&#243;n Social:</span><span class="rx-val">${escapeHtml(rec.name)}</span></div>
          <div class="rx-row"><span class="lbl">Domicilio Comercial:</span><span class="rx-val">${escapeHtml(rec.address)}</span></div>
        </div>
      </div>

      <div class="invoice-body">
        <div class="table-wrap">
          <table class="items">
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto / Servicio</th>
                <th>Cantidad</th>
                <th>U. medida</th>
                <th>Precio Unit.</th>
                <th>% Bonif</th>
                <th>Imp. Bonif.</th>
                <th>Subtotal</th>
                ${theadIva}
              </tr>
            </thead>
            <tbody>${itemsRows}</tbody>
          </table>
        </div>

        <div class="bottom-stack">
          <div class="totals-frame">
            <div class="totals-left">
              Importe Otros Tributos: $ ${formatArAmountCompact(data.totals.otherTaxes)}
            </div>
            <div class="totals-right">${totalsRightInner}</div>
          </div>
          ${cbuBlock}
          <div class="footer-block">
            <div class="footer-main">
              <div class="footer-l">
                <img src="${qrDataUrl}" alt="QR" width="92" height="92" />
                <div class="arca-mark">
                  <div class="arca-title">ARCA</div>
                  <div class="arca-sub">Administraci&#243;n Federal de Ingresos P&#250;blicos</div>
                </div>
              </div>
              <div class="footer-copy">
                <strong>Comprobante Autorizado</strong>
                Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operaci&#243;n
              </div>
              <div class="footer-cae">
                <div><strong>CAE N&#186;:</strong> ${escapeHtml(v.cae)}</div>
                <div><strong>Fecha de Vto. de CAE:</strong> ${escapeHtml(v.caeDueDate)}</div>
              </div>
            </div>
            <div class="pag-center">P&#225;g. ${copyIndex}/${totalCopies}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>`;
}
//# sourceMappingURL=invoice-template.js.map