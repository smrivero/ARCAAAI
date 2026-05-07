import type { FastifyInstance } from "fastify";
import {
  extractCaeFromConsultarResult,
  mapFeCompConsultarToInvoicePdfPayload,
} from "../arca/fecomp-consultar-to-invoice-pdf.js";
import {
  createVoucherBodySchema,
  feCAESolicitar,
  feCompConsultar,
  feCompUltimoAutorizado,
  listWsfeVouchers,
  WsfeError,
} from "../arca/wsfev1.js";
import {
  renderInvoicePdfBuffer,
  PlaywrightPdfSetupError,
} from "../pdf/invoice-pdf.js";
import { voucherPdfPostBodySchema } from "../pdf/invoice-models.js";
import {
  applyVoucherPdfMetadataToPayload,
  mergeVoucherPdfPostIntoPayload,
  parseVoucherPdfQueryMetadata,
} from "../pdf/invoice-pdf-merge.js";
import {
  getWsaaTicketAccess,
  WsaaAlreadyAuthenticatedError,
} from "../arca/wsaa.js";

const TA_CONFLICT_MESSAGE =
  "AFIP indicates a TA is already valid for this credential, but this backend has no usable copy (no valid ./tmp/ta.json). Wait until AFIP TTL expires or place a TA JSON file there after a successful login elsewhere.";

function wsfeErrorHttpStatus(err: WsfeError): number {
  const m = err.message;
  if (
    m.includes("tmp/ta.json") ||
    m.includes("Missing ARCA_CUIT") ||
    m.includes("ARCA_CUIT inválido")
  ) {
    return 400;
  }
  return 502;
}

const QUERY_DATE_YYYYMMDD = /^\d{8}$/;

export async function arcaRoutes(app: FastifyInstance) {
  app.get("/ping", async () => {
    return {
      ok: true,
      service: "arca",
      mode: "homo",
    };
  });

  /** Homologación: TA desde caché en memoria o WSAA. Solo para pruebas. */
  app.get("/wsaa/login", async (request, reply) => {
    try {
      const { token, sign, generationTime, expirationTime } = await getWsaaTicketAccess();
      return { ok: true, token, sign, generationTime, expirationTime };
    } catch (err) {
      if (err instanceof WsaaAlreadyAuthenticatedError) {
        request.log.warn({ err: err.name }, "WSAA alreadyAuthenticated (no token logged)");
        return await reply.status(409).send({
          ok: false,
          error: TA_CONFLICT_MESSAGE,
        });
      }
      request.log.error(
        err instanceof Error
          ? { errName: err.name, errMessage: err.message }
          : { err: String(err) },
        "GET /arca/wsaa/login failed",
      );
      const message = err instanceof Error ? err.message : String(err);
      return await reply.status(500).send({ ok: false, error: message });
    }
  });

  /**
   * WSFEv1 homo: último comprobante autorizado (TA en ./tmp/ta.json).
   * Query: ptoVta, cbteTipo (default 1 y 6).
   */
  app.get("/wsfe/last-voucher", async (request, reply) => {
    try {
      const q = request.query as Record<string, string | undefined>;
      const ptoVta = Number(q["ptoVta"] ?? "1");
      const cbteTipo = Number(q["cbteTipo"] ?? "6");
      if (
        !Number.isInteger(ptoVta) ||
        ptoVta < 1 ||
        ptoVta > 99999 ||
        !Number.isInteger(cbteTipo) ||
        cbteTipo < 1
      ) {
        return await reply.status(400).send({
          ok: false,
          error: "Query inválida: ptoVta y cbteTipo deben ser enteros (ptoVta 1–99999, cbteTipo ≥ 1).",
        });
      }

      const data = await feCompUltimoAutorizado({ ptoVta, cbteTipo });
      return { ok: true, data };
    } catch (err) {
      if (err instanceof WsfeError) {
        const status = wsfeErrorHttpStatus(err);
        request.log.warn({ errMsg: err.message }, "GET /arca/wsfe/last-voucher");
        return await reply.status(status).send({ ok: false, error: err.message });
      }
      request.log.error(
        err instanceof Error
          ? { errName: err.name, errMessage: err.message }
          : { err: String(err) },
        "GET /arca/wsfe/last-voucher failed",
      );
      const message = err instanceof Error ? err.message : String(err);
      return await reply.status(500).send({ ok: false, error: message });
    }
  });

  /**
   * WSFE homo: listado paginado hacia atrás vía último autorizado + `FECompConsultar`.
   * Query obligatorios: ptoVta, cbteTipo. Opcional: limit (default 20, máx 100), fromDate/toDate yyyymmdd.
   */
  app.get("/wsfe/vouchers", async (request, reply) => {
    try {
      const q = request.query as Record<string, string | undefined>;
      const ptoVtaRaw = q["ptoVta"];
      const cbteTipoRaw = q["cbteTipo"];
      const ptoVta = Number(ptoVtaRaw);
      const cbteTipo = Number(cbteTipoRaw);
      if (
        ptoVtaRaw === undefined ||
        cbteTipoRaw === undefined ||
        !Number.isInteger(ptoVta) ||
        ptoVta < 1 ||
        ptoVta > 99999 ||
        !Number.isInteger(cbteTipo) ||
        cbteTipo < 1
      ) {
        return await reply.status(400).send({
          ok: false,
          error:
            "Query inválida: `ptoVta` y `cbteTipo` son obligatorios (enteros, ptoVta 1–99999, cbteTipo ≥ 1).",
        });
      }

      let limitParsed: number | undefined;
      if (q["limit"] !== undefined && q["limit"] !== "") {
        const lim = Number(q["limit"]);
        if (!Number.isInteger(lim) || lim < 1 || lim > 100) {
          return await reply.status(400).send({
            ok: false,
            error: "`limit` debe ser un entero entre 1 y 100.",
          });
        }
        limitParsed = lim;
      }

      const fromDateIn = q["fromDate"]?.trim();
      const toDateIn = q["toDate"]?.trim();
      const fromDate = fromDateIn !== "" ? fromDateIn : undefined;
      const toDate = toDateIn !== "" ? toDateIn : undefined;

      if (fromDate !== undefined && !QUERY_DATE_YYYYMMDD.test(fromDate)) {
        return await reply.status(400).send({
          ok: false,
          error: "`fromDate` debe tener formato yyyymmdd (8 dígitos).",
        });
      }
      if (toDate !== undefined && !QUERY_DATE_YYYYMMDD.test(toDate)) {
        return await reply.status(400).send({
          ok: false,
          error: "`toDate` debe tener formato yyyymmdd (8 dígitos).",
        });
      }
      if (fromDate !== undefined && toDate !== undefined && fromDate > toDate) {
        return await reply.status(400).send({
          ok: false,
          error: "`fromDate` no puede ser posterior a `toDate`.",
        });
      }

      const payload = await listWsfeVouchers({
        ptoVta,
        cbteTipo,
        ...(limitParsed !== undefined ? { limit: limitParsed } : {}),
        ...(fromDate !== undefined ? { fromDate } : {}),
        ...(toDate !== undefined ? { toDate } : {}),
      });
      return payload;
    } catch (err) {
      if (err instanceof WsfeError) {
        const status = wsfeErrorHttpStatus(err);
        request.log.warn({ errMsg: err.message }, "GET /arca/wsfe/vouchers");
        return await reply.status(status).send({ ok: false, error: err.message });
      }
      request.log.error(
        err instanceof Error
          ? { errName: err.name, errMessage: err.message }
          : { err: String(err) },
        "GET /arca/wsfe/vouchers failed",
      );
      const message = err instanceof Error ? err.message : String(err);
      return await reply.status(500).send({ ok: false, error: message });
    }
  });

  /**
   * WSFE homo: PDF de un comprobante ya autorizado (`FECompConsultar` + plantilla estilo Comprobantes en Línea ARCA).
   * Query obligatorios: ptoVta, cbteTipo, cbteNro.
   *
   * Opcionales (datos comerciales no provistos por WSFE o para reemplazar env):
   * issuerName, issuerAddress, issuerIvaCondition, issuerIibb, issuerActivityStartDate,
   * receiverName, receiverAddress, receiverIvaCondition, saleCondition,
   * serviceFrom, serviceTo, paymentDueDate, itemDescription.
   * `copies`: omiso o `original` → solo ORIGINAL; `all` → ORIGINAL+DUPLICADO+TRIPLICADO; `original,duplicado` combina.
   */
  app.get("/wsfe/voucher-pdf", async (request, reply) => {
    try {
      const q = request.query as Record<string, string | undefined>;
      const ptoVtaRaw = q["ptoVta"];
      const cbteTipoRaw = q["cbteTipo"];
      const cbteNroRaw = q["cbteNro"];
      const ptoVta = Number(ptoVtaRaw);
      const cbteTipo = Number(cbteTipoRaw);
      const cbteNro = Number(cbteNroRaw);
      if (
        ptoVtaRaw === undefined ||
        cbteTipoRaw === undefined ||
        cbteNroRaw === undefined ||
        !Number.isInteger(ptoVta) ||
        !Number.isInteger(cbteTipo) ||
        !Number.isInteger(cbteNro) ||
        ptoVta < 1 ||
        ptoVta > 99999 ||
        cbteTipo < 1 ||
        cbteNro < 1
      ) {
        return await reply.status(400).send({
          ok: false,
          error:
            "Query inválida: `ptoVta`, `cbteTipo` y `cbteNro` son obligatorios (enteros positivos).",
        });
      }

      const row = await feCompConsultar({ ptoVta, cbteTipo, cbteNro });
      if (row === null) {
        return await reply.status(404).send({
          ok: false,
          error: "Comprobante no encontrado.",
        });
      }

      if (extractCaeFromConsultarResult(row) === null) {
        return await reply.status(400).send({
          ok: false,
          error: "El comprobante no tiene CAE (CodAutorizacion) para generar PDF.",
        });
      }

      let payload;
      try {
        payload = mapFeCompConsultarToInvoicePdfPayload(row, {
          ptoVta,
          cbteTipo,
          cbteNro,
        });
      } catch (mapErr) {
        const msg = mapErr instanceof Error ? mapErr.message : String(mapErr);
        if (msg.includes("ARCA_CUIT")) {
          request.log.warn({ errMsg: msg }, "GET /arca/wsfe/voucher-pdf configuración");
          return await reply.status(400).send({ ok: false, error: msg });
        }
        throw mapErr;
      }

      payload = applyVoucherPdfMetadataToPayload(payload, parseVoucherPdfQueryMetadata(q));

      const pdfBuf = await renderInvoicePdfBuffer(payload);
      const filename = `invoice-${cbteTipo}-${ptoVta}-${cbteNro}.pdf`;
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `inline; filename="${filename}"`);
      return await reply.send(pdfBuf);
    } catch (err) {
      if (err instanceof PlaywrightPdfSetupError) {
        request.log.warn({ errMsg: err.message }, "GET /arca/wsfe/voucher-pdf sin navegador PDF");
        return await reply.status(503).send({ ok: false, error: err.message });
      }
      if (err instanceof WsfeError) {
        const status = wsfeErrorHttpStatus(err);
        request.log.warn({ errMsg: err.message }, "GET /arca/wsfe/voucher-pdf");
        return await reply.status(status).send({ ok: false, error: err.message });
      }
      request.log.error(
        err instanceof Error
          ? { errName: err.name, errMessage: err.message }
          : { err: String(err) },
        "GET /arca/wsfe/voucher-pdf failed",
      );
      const message = err instanceof Error ? err.message : String(err);
      return await reply.status(500).send({ ok: false, error: message });
    }
  });

  /**
   * Igual que GET `/wsfe/voucher-pdf`, pero permite enriquecer emisor/receptor/ítems/plazos en el JSON
   * (FECompConsultar sigue siendo la fuente de CAE y totales fiscales).
   */
  app.post("/wsfe/voucher-pdf", async (request, reply) => {
    const parsed = voucherPdfPostBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join("; ");
      return await reply.status(400).send({
        ok: false,
        error: `Body inválido: ${issues}`,
      });
    }
    const body = parsed.data;
    const { ptoVta, cbteTipo, cbteNro } = body;

    try {
      const row = await feCompConsultar({ ptoVta, cbteTipo, cbteNro });
      if (row === null) {
        return await reply.status(404).send({
          ok: false,
          error: "Comprobante no encontrado.",
        });
      }

      if (extractCaeFromConsultarResult(row) === null) {
        return await reply.status(400).send({
          ok: false,
          error: "El comprobante no tiene CAE (CodAutorizacion) para generar PDF.",
        });
      }

      let payload;
      try {
        payload = mapFeCompConsultarToInvoicePdfPayload(row, {
          ptoVta,
          cbteTipo,
          cbteNro,
        });
      } catch (mapErr) {
        const msg = mapErr instanceof Error ? mapErr.message : String(mapErr);
        if (msg.includes("ARCA_CUIT")) {
          request.log.warn({ errMsg: msg }, "POST /arca/wsfe/voucher-pdf configuración");
          return await reply.status(400).send({ ok: false, error: msg });
        }
        throw mapErr;
      }

      payload = mergeVoucherPdfPostIntoPayload(payload, body);
      console.log("[pdf] merged invoice data", JSON.stringify(payload, null, 2));

      const pdfBuf = await renderInvoicePdfBuffer(payload);
      const filename = `invoice-${cbteTipo}-${ptoVta}-${cbteNro}.pdf`;
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `inline; filename="${filename}"`);
      return await reply.send(pdfBuf);
    } catch (err) {
      if (err instanceof PlaywrightPdfSetupError) {
        request.log.warn({ errMsg: err.message }, "POST /arca/wsfe/voucher-pdf sin navegador PDF");
        return await reply.status(503).send({ ok: false, error: err.message });
      }
      if (err instanceof WsfeError) {
        const status = wsfeErrorHttpStatus(err);
        request.log.warn({ errMsg: err.message }, "POST /arca/wsfe/voucher-pdf");
        return await reply.status(status).send({ ok: false, error: err.message });
      }
      request.log.error(
        err instanceof Error
          ? { errName: err.name, errMessage: err.message }
          : { err: String(err) },
        "POST /arca/wsfe/voucher-pdf failed",
      );
      const message = err instanceof Error ? err.message : String(err);
      return await reply.status(500).send({ ok: false, error: message });
    }
  });

  /** WSFE homo: emisión mínima Factura B (`FECAESolicitar`). TA en `./tmp/ta.json`. */
  app.post("/wsfe/create-voucher", async (request, reply) => {
    const parsed = createVoucherBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join("; ");
      return await reply.status(400).send({
        ok: false,
        error: `Body inválido: ${issues}`,
      });
    }

    try {
      const r = await feCAESolicitar(parsed.data);
      const hasCae = Boolean(r.cae && r.cae.trim() !== "");
      const resultado = r.result?.trim().toUpperCase() ?? "";
      /** Aprobación solo con CAE y Resultado A. Rechazo observable (p. ej. R sin CAE): `ok` false y `observations[]` del detalle. */
      const approved = resultado === "A" && hasCae;
      return await reply.send({
        ok: approved,
        voucherNumber: r.voucherNumber,
        cae: r.cae,
        caeDueDate: r.caeDueDate,
        result: r.result,
        observations: r.observations,
        errors: r.errors,
        raw: r.raw,
      });
    } catch (err) {
      if (err instanceof WsfeError) {
        const status = wsfeErrorHttpStatus(err);
        request.log.warn({ errMsg: err.message }, "POST /arca/wsfe/create-voucher");
        return await reply.status(status).send({ ok: false, error: err.message });
      }
      request.log.error(
        err instanceof Error
          ? { errName: err.name, errMessage: err.message }
          : { err: String(err) },
        "POST /arca/wsfe/create-voucher failed",
      );
      const message = err instanceof Error ? err.message : String(err);
      return await reply.status(500).send({ ok: false, error: message });
    }
  });
}
