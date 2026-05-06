import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import QRCode from "qrcode";
import { buildInvoiceHtml } from "./invoice-template.js";
function onlyDigits(s) {
    return s.replace(/\D/g, "");
}
/** Navegador no disponible: binario Playwright o Chrome/Edge instalado. Usar 503 en API. */
export class PlaywrightPdfSetupError extends Error {
    name = "PlaywrightPdfSetupError";
}
async function launchChromiumForPdf() {
    const custom = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"]?.trim();
    /** Orden: ejecutable configurado → Chromium bundleado → Chrome/Edge del sistema. */
    const attempts = [];
    if (custom !== undefined && custom !== "") {
        attempts.push({
            label: "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
            opts: { headless: true, executablePath: custom },
        });
    }
    attempts.push({ label: "bundledHeadlessShell", opts: { headless: true } });
    attempts.push({
        label: "channelChrome",
        opts: { headless: true, channel: "chrome" },
    });
    attempts.push({
        label: "channelMsEdge",
        opts: { headless: true, channel: "msedge" },
    });
    const lastErrors = [];
    for (const { label, opts } of attempts) {
        try {
            return await chromium.launch(opts);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            lastErrors.push(`${label}: ${msg.slice(0, 200)}`);
        }
    }
    throw new PlaywrightPdfSetupError([
        "No hay navegador disponible para generar el PDF.",
        "Ejecutá `npx playwright install chromium`, o instalá Google Chrome (se usa como respaldo).",
        "Opcional: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/ruta/al ejecutable`.",
        `Últimos fallos: ${lastErrors.slice(-3).join(" — ")}`,
    ].join(" "));
}
function issueDateDdmmyyyyToYyyymmdd(issueDate) {
    const parts = issueDate.split("/").map((p) => p.trim());
    if (parts.length !== 3 || parts.some((x) => x === "")) {
        throw new Error("issueDate debe ser DD/MM/YYYY.");
    }
    const [dd, mm, yyyy] = parts;
    if (yyyy.length !== 4 ||
        dd.length !== 2 ||
        mm.length !== 2 ||
        !/^\d+$/.test(yyyy + mm + dd)) {
        throw new Error("issueDate debe ser DD/MM/YYYY.");
    }
    return `${yyyy}${mm.padStart(2, "0")}${dd.padStart(2, "0")}`;
}
function resolveCbteTipo(payload) {
    const v = payload.voucher.cbteTipo;
    if (v !== undefined) {
        return v;
    }
    const parsed = Number.parseInt(payload.voucher.code, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("cbteTipo: indicá voucher.cbteTipo o un voucher.code numérico (p. ej. 011 → 11).");
    }
    return parsed;
}
function resolveQrDocReceiver(payload) {
    const recv = payload.receiver;
    if (recv.docTipo !== undefined && recv.docNro !== undefined) {
        return { tipoDocRec: recv.docTipo, nroDocRec: recv.docNro };
    }
    const digits = recv.cuit !== undefined ? onlyDigits(recv.cuit) : "";
    if (digits.length >= 11) {
        return { tipoDocRec: 80, nroDocRec: Number.parseInt(digits.slice(0, 11), 10) };
    }
    return { tipoDocRec: 99, nroDocRec: 0 };
}
export function buildAfipQrPayload(payload, cbteTipo) {
    const fecha = issueDateDdmmyyyyToYyyymmdd(payload.voucher.issueDate);
    const cuitEmit = Number.parseInt(onlyDigits(payload.issuer.cuit).slice(0, 11), 10);
    const { tipoDocRec, nroDocRec } = resolveQrDocReceiver(payload);
    const importeRaw = payload.totals.total;
    const importe = typeof importeRaw === "number" && Number.isFinite(importeRaw)
        ? Math.round(importeRaw * 100) / 100
        : importeRaw;
    const moneda = payload.voucher.moneda ?? "PES";
    const ctz = payload.voucher.ctz ?? 1;
    const codAutStr = payload.voucher.cae.replace(/\s/g, "");
    const codAut = /^\d+$/.test(codAutStr) ? Number.parseInt(codAutStr, 10) : codAutStr;
    return {
        ver: 1,
        fecha,
        cuit: cuitEmit,
        ptoVta: payload.voucher.ptoVta,
        tipoCmp: cbteTipo,
        nroCmp: payload.voucher.number,
        importe,
        moneda,
        ctz,
        tipoDocRec,
        nroDocRec,
        tipoCodAut: "E",
        codAut,
    };
}
export function buildAfipQrUrl(payload, cbteTipo) {
    const qrObj = buildAfipQrPayload(payload, cbteTipo);
    const json = JSON.stringify(qrObj);
    const p = Buffer.from(json, "utf8").toString("base64url");
    return `https://www.afip.gob.ar/fe/qr/?p=${p}`;
}
async function buildInvoiceHtmlWithQr(payload) {
    const cbteTipo = resolveCbteTipo(payload);
    const qrHref = buildAfipQrUrl(payload, cbteTipo);
    const qrDataUrl = await QRCode.toDataURL(qrHref, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 220,
        color: { dark: "#000000", light: "#ffffff" },
    });
    return buildInvoiceHtml(payload, qrDataUrl);
}
async function renderHtmlToPdfBuffer(html) {
    let browser = null;
    try {
        browser = await launchChromiumForPdf();
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        const buf = await page.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: "0", bottom: "0", left: "0", right: "0" },
        });
        await page.close();
        return Buffer.from(buf);
    }
    finally {
        if (browser !== null) {
            await browser.close();
        }
    }
}
/** Genera el PDF en memoria (mismo layout que `renderInvoicePdf`). */
export async function renderInvoicePdfBuffer(payload) {
    const html = await buildInvoiceHtmlWithQr(payload);
    return renderHtmlToPdfBuffer(html);
}
export async function renderInvoicePdf(payload) {
    const html = await buildInvoiceHtmlWithQr(payload);
    const buf = await renderHtmlToPdfBuffer(html);
    const cbteTipo = resolveCbteTipo(payload);
    const cuitFile = onlyDigits(payload.issuer.cuit).slice(0, 11).padStart(11, "0");
    const filename = `${cuitFile}_${cbteTipo}_${payload.voucher.ptoVta}_${payload.voucher.number}.pdf`;
    const dir = path.join(process.cwd(), "tmp", "invoices");
    await mkdir(dir, { recursive: true });
    const outPath = path.resolve(path.join(dir, filename));
    await writeFile(outPath, buf);
    return { path: outPath, filename };
}
export { invoicePdfBodySchema, voucherPdfPostBodySchema } from "./invoice-models.js";
//# sourceMappingURL=invoice-pdf.js.map