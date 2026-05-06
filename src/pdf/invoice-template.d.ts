import type { InvoicePdfPayload } from "./invoice-models.js";
/** CUIT argentino XX-XXXXXXXX-X */
export declare function formatCuitDisplay(raw: string): string;
/** Montos estilo ARCA: coma decimal, sin separador de miles. */
export declare function formatArAmountCompact(n: number): string;
export declare function formatArAmount(n: number): string;
export declare function buildInvoiceHtml(data: InvoicePdfPayload, qrDataUrl: string): string;
//# sourceMappingURL=invoice-template.d.ts.map