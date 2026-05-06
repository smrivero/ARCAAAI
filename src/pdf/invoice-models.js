import { z } from "zod";
const copyTypeEnum = z.enum(["ORIGINAL", "DUPLICADO", "TRIPLICADO"]);
/** Línea de detalle en el PDF (tabla ítems). */
export const invoiceLineItemSchema = z.object({
    code: z.string().optional(),
    description: z.string(),
    quantity: z.number(),
    unit: z.string(),
    unitPrice: z.number(),
    discountPercent: z.number(),
    discountAmount: z.number(),
    subtotal: z.number(),
    /** Texto columna Alicuota (p. ej. "21 %"). */
    alicuotaIva: z.string().optional(),
    /** Subtotal con IVA de la línea. */
    subtotalWithIva: z.number().optional(),
});
export const invoicePdfBodySchema = z.object({
    copyTypes: z.array(copyTypeEnum).min(1),
    issuer: z.object({
        name: z.string().min(1),
        cuit: z.string().min(1),
        ivaCondition: z.string().min(1),
        address: z.string().min(1),
        iibb: z.string().optional(),
        activityStartDate: z.string().optional(),
    }),
    receiver: z.object({
        name: z.string().min(1),
        cuit: z.string().optional(),
        ivaCondition: z.string().min(1),
        address: z.string().min(1),
        docTipo: z.number().int().optional(),
        docNro: z.number().int().nonnegative().optional(),
    }),
    voucher: z.object({
        letter: z.string().min(1),
        typeName: z.string().min(1),
        code: z.string().min(1),
        cbteTipo: z.number().int().min(1).optional(),
        ptoVta: z.number().int().min(1).max(99999),
        number: z.number().int().min(1),
        issueDate: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
        serviceFrom: z.string().min(1),
        serviceTo: z.string().min(1),
        paymentDueDate: z.string().min(1),
        saleCondition: z.string().min(1),
        cae: z.string().min(1),
        caeDueDate: z.string().min(1),
        moneda: z.string().min(1).optional(),
        ctz: z.number().positive().optional(),
        /** Opcional. Pie del comprobante (estilo ARCA). */
        cbu: z.string().optional(),
    }),
    items: z.array(invoiceLineItemSchema).min(1),
    totals: z.object({
        /** Neto gravado (Importe Neto Gravado). Suele igualar subtotal gravado. */
        subtotal: z.number(),
        otherTaxes: z.number(),
        total: z.number(),
        /** Si falta en plantilla se usa subtotal. */
        importeNetoGravado: z.number().optional(),
        /**
         * Desglose IVA tipo comprobante ARCA (27 %, 21 %, …). Si falta, la plantilla lo infiere.
         */
        ivaLines: z
            .array(z.object({
            label: z.string(),
            amount: z.number(),
        }))
            .optional(),
    }),
});
/**
 * POST `/arca/wsfe/voucher-pdf`: comprobante fiscal desde WSFE + datos comerciales opcionales.
 * Los totales y CAE provienen de `FECompConsultar`; issuer/receiver/ítems pueden enriquecerse.
 */
export const voucherPdfPostBodySchema = z.object({
    ptoVta: z.number().int().min(1).max(99999),
    cbteTipo: z.number().int().min(1),
    cbteNro: z.number().int().min(1),
    copies: z.array(copyTypeEnum).min(1).optional(),
    issuer: z
        .object({
        name: z.string().min(1).optional(),
        cuit: z.string().min(1).optional(),
        address: z.string().min(1).optional(),
        ivaCondition: z.string().min(1).optional(),
        iibb: z.string().optional(),
        activityStartDate: z.string().optional(),
    })
        .optional(),
    receiver: z
        .object({
        name: z.string().min(1).optional(),
        cuit: z.string().optional(),
        ivaCondition: z.string().min(1).optional(),
        address: z.string().min(1).optional(),
    })
        .optional(),
    voucherExtra: z
        .object({
        saleCondition: z.string().min(1).optional(),
        serviceFrom: z.string().min(1).optional(),
        serviceTo: z.string().min(1).optional(),
        paymentDueDate: z.string().min(1).optional(),
        cbu: z.string().optional(),
    })
        .optional(),
    items: z.array(invoiceLineItemSchema).min(1).optional(),
});
//# sourceMappingURL=invoice-models.js.map