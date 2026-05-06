import type { FastifyInstance } from "fastify";
import { invoicePdfBodySchema, PlaywrightPdfSetupError, renderInvoicePdf } from "../pdf/invoice-pdf.js";

export async function pdfRoutes(app: FastifyInstance): Promise<void> {
  /** Genera PDF de factura electrónica (copias ORIGINAL/DUPLICADO/TRIPLICADO) en `tmp/invoices`. */
  app.post("/invoice", async (request, reply) => {
    const parsed = invoicePdfBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join("; ");
      return await reply.status(400).send({ ok: false, error: `Body inválido: ${msg}` });
    }

    try {
      const { path: pdfPath, filename } = await renderInvoicePdf(parsed.data);
      return { ok: true, path: pdfPath, filename };
    } catch (err) {
      if (err instanceof PlaywrightPdfSetupError) {
        request.log.warn({ errMsg: err.message }, "POST /pdf/invoice sin navegador PDF");
        return await reply.status(503).send({ ok: false, error: err.message });
      }
      request.log.error(
        err instanceof Error ? { errName: err.name, errMessage: err.message } : { err: String(err) },
        "POST /pdf/invoice PDF failed",
      );
      const msg = err instanceof Error ? err.message : String(err);
      return await reply.status(500).send({ ok: false, error: msg });
    }
  });
}
