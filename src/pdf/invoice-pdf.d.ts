import type { InvoicePdfPayload } from "./invoice-models.js";
/** Navegador no disponible: binario Playwright o Chrome/Edge instalado. Usar 503 en API. */
export declare class PlaywrightPdfSetupError extends Error {
    readonly name = "PlaywrightPdfSetupError";
}
export declare function buildAfipQrPayload(payload: InvoicePdfPayload, cbteTipo: number): Record<string, unknown>;
export declare function buildAfipQrUrl(payload: InvoicePdfPayload, cbteTipo: number): string;
/** Genera el PDF en memoria (mismo layout que `renderInvoicePdf`). */
export declare function renderInvoicePdfBuffer(payload: InvoicePdfPayload): Promise<Buffer>;
export declare function renderInvoicePdf(payload: InvoicePdfPayload): Promise<{
    path: string;
    filename: string;
}>;
export { invoicePdfBodySchema, voucherPdfPostBodySchema } from "./invoice-models.js";
export type { InvoicePdfPayload } from "./invoice-models.js";
//# sourceMappingURL=invoice-pdf.d.ts.map