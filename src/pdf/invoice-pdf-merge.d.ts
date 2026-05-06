import type { InvoicePdfPayload, VoucherPdfPostBody } from "./invoice-models.js";
/** Query `copies`: default solo ORIGINAL; `all` = las tres copias; o lista separada por coma. Case-insensitive. */
export declare function copyTypesFromQueryParam(copiesRaw: string | undefined): InvoicePdfPayload["copyTypes"];
/** Metadatos comerciales opcionales vía query string (GET voucher-pdf). */
export type VoucherPdfQueryMetadata = {
    copyTypes?: InvoicePdfPayload["copyTypes"];
    issuerName?: string;
    issuerAddress?: string;
    issuerIvaCondition?: string;
    issuerIibb?: string;
    issuerActivityStartDate?: string;
    receiverName?: string;
    receiverAddress?: string;
    receiverIvaCondition?: string;
    saleCondition?: string;
    serviceFrom?: string;
    serviceTo?: string;
    paymentDueDate?: string;
    itemDescription?: string;
};
export declare function parseVoucherPdfQueryMetadata(q: Record<string, string | undefined>): VoucherPdfQueryMetadata;
/** Aplica overrides comerciales encima del payload generado desde FECompConsultar. */
export declare function applyVoucherPdfMetadataToPayload(base: InvoicePdfPayload, meta: VoucherPdfQueryMetadata): InvoicePdfPayload;
/**
 * Base: payload fiscal desde `FECompConsultar` (`mapFeCompConsultarToInvoicePdfPayload`).
 * El body POST solo pisa campos explícitos y válidos; el resto queda del comprobante consultado.
 */
export declare function mergeVoucherPdfPostIntoPayload(base: InvoicePdfPayload, body: VoucherPdfPostBody): InvoicePdfPayload;
//# sourceMappingURL=invoice-pdf-merge.d.ts.map