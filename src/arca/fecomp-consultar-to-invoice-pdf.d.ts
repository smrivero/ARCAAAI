import type { InvoicePdfPayload } from "../pdf/invoice-models.js";
/**
 * Construye el payload del HTML/PDF a partir del `ResultGet` de `FECompConsultar`.
 * El emisor se completa con `ARCA_CUIT` y opcionalmente `ARCA_PDF_ISSUER_*`.
 */
export declare function mapFeCompConsultarToInvoicePdfPayload(rg: Record<string, unknown>, query: {
    ptoVta: number;
    cbteTipo: number;
    cbteNro: number;
}): InvoicePdfPayload;
/** CAE / CodAutorización presente y no vacío. */
export declare function extractCaeFromConsultarResult(rg: Record<string, unknown>): string | null;
//# sourceMappingURL=fecomp-consultar-to-invoice-pdf.d.ts.map