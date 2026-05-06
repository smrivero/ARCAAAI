import { z } from "zod";
/** Línea de detalle en el PDF (tabla ítems). */
export declare const invoiceLineItemSchema: z.ZodObject<{
    code: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
    quantity: z.ZodNumber;
    unit: z.ZodString;
    unitPrice: z.ZodNumber;
    discountPercent: z.ZodNumber;
    discountAmount: z.ZodNumber;
    subtotal: z.ZodNumber;
    alicuotaIva: z.ZodOptional<z.ZodString>;
    subtotalWithIva: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const invoicePdfBodySchema: z.ZodObject<{
    copyTypes: z.ZodArray<z.ZodEnum<{
        ORIGINAL: "ORIGINAL";
        DUPLICADO: "DUPLICADO";
        TRIPLICADO: "TRIPLICADO";
    }>>;
    issuer: z.ZodObject<{
        name: z.ZodString;
        cuit: z.ZodString;
        ivaCondition: z.ZodString;
        address: z.ZodString;
        iibb: z.ZodOptional<z.ZodString>;
        activityStartDate: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    receiver: z.ZodObject<{
        name: z.ZodString;
        cuit: z.ZodOptional<z.ZodString>;
        ivaCondition: z.ZodString;
        address: z.ZodString;
        docTipo: z.ZodOptional<z.ZodNumber>;
        docNro: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    voucher: z.ZodObject<{
        letter: z.ZodString;
        typeName: z.ZodString;
        code: z.ZodString;
        cbteTipo: z.ZodOptional<z.ZodNumber>;
        ptoVta: z.ZodNumber;
        number: z.ZodNumber;
        issueDate: z.ZodString;
        serviceFrom: z.ZodString;
        serviceTo: z.ZodString;
        paymentDueDate: z.ZodString;
        saleCondition: z.ZodString;
        cae: z.ZodString;
        caeDueDate: z.ZodString;
        moneda: z.ZodOptional<z.ZodString>;
        ctz: z.ZodOptional<z.ZodNumber>;
        cbu: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    items: z.ZodArray<z.ZodObject<{
        code: z.ZodOptional<z.ZodString>;
        description: z.ZodString;
        quantity: z.ZodNumber;
        unit: z.ZodString;
        unitPrice: z.ZodNumber;
        discountPercent: z.ZodNumber;
        discountAmount: z.ZodNumber;
        subtotal: z.ZodNumber;
        alicuotaIva: z.ZodOptional<z.ZodString>;
        subtotalWithIva: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    totals: z.ZodObject<{
        subtotal: z.ZodNumber;
        otherTaxes: z.ZodNumber;
        total: z.ZodNumber;
        importeNetoGravado: z.ZodOptional<z.ZodNumber>;
        ivaLines: z.ZodOptional<z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            amount: z.ZodNumber;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type InvoicePdfPayload = z.infer<typeof invoicePdfBodySchema>;
/**
 * POST `/arca/wsfe/voucher-pdf`: comprobante fiscal desde WSFE + datos comerciales opcionales.
 * Los totales y CAE provienen de `FECompConsultar`; issuer/receiver/ítems pueden enriquecerse.
 */
export declare const voucherPdfPostBodySchema: z.ZodObject<{
    ptoVta: z.ZodNumber;
    cbteTipo: z.ZodNumber;
    cbteNro: z.ZodNumber;
    copies: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        ORIGINAL: "ORIGINAL";
        DUPLICADO: "DUPLICADO";
        TRIPLICADO: "TRIPLICADO";
    }>>>;
    issuer: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        cuit: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodString>;
        ivaCondition: z.ZodOptional<z.ZodString>;
        iibb: z.ZodOptional<z.ZodString>;
        activityStartDate: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    receiver: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        cuit: z.ZodOptional<z.ZodString>;
        ivaCondition: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    voucherExtra: z.ZodOptional<z.ZodObject<{
        saleCondition: z.ZodOptional<z.ZodString>;
        serviceFrom: z.ZodOptional<z.ZodString>;
        serviceTo: z.ZodOptional<z.ZodString>;
        paymentDueDate: z.ZodOptional<z.ZodString>;
        cbu: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    items: z.ZodOptional<z.ZodArray<z.ZodObject<{
        code: z.ZodOptional<z.ZodString>;
        description: z.ZodString;
        quantity: z.ZodNumber;
        unit: z.ZodString;
        unitPrice: z.ZodNumber;
        discountPercent: z.ZodNumber;
        discountAmount: z.ZodNumber;
        subtotal: z.ZodNumber;
        alicuotaIva: z.ZodOptional<z.ZodString>;
        subtotalWithIva: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type VoucherPdfPostBody = z.infer<typeof voucherPdfPostBodySchema>;
//# sourceMappingURL=invoice-models.d.ts.map