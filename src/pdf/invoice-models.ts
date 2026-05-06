import { z } from "zod";

const copyTypeEnum = z.enum(["ORIGINAL", "DUPLICADO", "TRIPLICADO"]);

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
  }),
  items: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number(),
        unit: z.string(),
        unitPrice: z.number(),
        discountPercent: z.number(),
        discountAmount: z.number(),
        subtotal: z.number(),
      }),
    )
    .min(1),
  totals: z.object({
    subtotal: z.number(),
    otherTaxes: z.number(),
    total: z.number(),
  }),
});

export type InvoicePdfPayload = z.infer<typeof invoicePdfBodySchema>;
