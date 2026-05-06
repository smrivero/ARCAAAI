import type { InvoicePdfPayload } from "../pdf/invoice-models.js";

function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

function parseMoney(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  const s = String(v ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function parseIntLoose(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  const d = onlyDigits(String(v ?? ""));
  if (d === "") {
    return 0;
  }
  return Number.parseInt(d.slice(0, 12), 10);
}

/** `CbteFch` / `FchVto` AFIP: YYYYMMDD u 8 dígitos. */
function afipYyyymmddToDdmmyyyy(raw: unknown, fallback: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 8) {
    return fallback;
  }
  const y = digits.slice(0, 4);
  const m = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  return `${d}/${m}/${y}`;
}

const CBTE_TIPO_DISPLAY: Partial<
  Record<number, { letter: string; typeName: string }>
> = {
  1: { letter: "A", typeName: "FACTURA" },
  2: { letter: "A", typeName: "NOTA DE DÉBITO" },
  3: { letter: "A", typeName: "NOTA DE CRÉDITO" },
  6: { letter: "B", typeName: "FACTURA" },
  7: { letter: "B", typeName: "NOTA DE DÉBITO" },
  8: { letter: "B", typeName: "NOTA DE CRÉDITO" },
  11: { letter: "C", typeName: "FACTURA" },
  12: { letter: "C", typeName: "NOTA DE DÉBITO" },
  13: { letter: "C", typeName: "NOTA DE CRÉDITO" },
  15: { letter: "C", typeName: "RECIBO" },
};

const DOC_RECEPTOR_IVAGUESS: Partial<Record<number, string>> = {
  80: "CUIT receptor",
  86: "CUIL receptor",
  87: "CDI receptor",
  89: "Pasaporte receptor",
  96: "DNI receptor",
  99: "Consumidor Final",
};

function voucherKind(cbteTipo: number): { letter: string; typeName: string; code: string } {
  const code = String(cbteTipo).padStart(3, "0");
  const row = CBTE_TIPO_DISPLAY[cbteTipo];
  if (row) {
    return { letter: row.letter, typeName: row.typeName, code };
  }
  return { letter: "-", typeName: "COMPROBANTE", code };
}

function normalizeAlicIvaRecords(ivaNode: unknown): Array<Record<string, unknown>> {
  if (!ivaNode || typeof ivaNode !== "object") {
    return [];
  }
  const rec = ivaNode as Record<string, unknown>;
  const raw = rec["AlicIva"];
  const list = Array.isArray(raw) ? raw : raw !== undefined && raw !== null ? [raw] : [];
  return list.filter((x): x is Record<string, unknown> => x !== null && typeof x === "object");
}

function issuerFromEnv(): { name: string; cuit: string; ivaCondition: string; address: string } {
  const cuit = onlyDigits(process.env["ARCA_CUIT"] ?? "");
  if (cuit.length < 11) {
    throw new Error("ARCA_CUIT inválido o ausente: hace falta para el PDF del emisor.");
  }
  const name = (process.env["ARCA_PDF_ISSUER_NAME"] ?? "Emitente").trim() || "Emitente";
  const ivaCondition =
    (process.env["ARCA_PDF_ISSUER_IVA_CONDITION"] ?? "—").trim() || "—";
  const address = (process.env["ARCA_PDF_ISSUER_ADDRESS"] ?? "—").trim() || "—";
  return { name, cuit, ivaCondition, address };
}

/**
 * Construye el payload del HTML/PDF a partir del `ResultGet` de `FECompConsultar`.
 * El emisor se completa con `ARCA_CUIT` y opcionalmente `ARCA_PDF_ISSUER_*`.
 */
export function mapFeCompConsultarToInvoicePdfPayload(
  rg: Record<string, unknown>,
  query: { ptoVta: number; cbteTipo: number; cbteNro: number },
): InvoicePdfPayload {
  const cae =
    String(rg["CodAutorizacion"] ?? rg["CAE"] ?? "")
      .trim()
      .replace(/\s/g, "");
  if (cae === "") {
    throw new Error("El comprobante no incluye CAE (CodAutorizacion).");
  }

  const ptoVta = parseIntLoose(rg["PtoVta"] ?? query.ptoVta) || query.ptoVta;
  const cbteTipo = parseIntLoose(rg["CbteTipo"] ?? query.cbteTipo) || query.cbteTipo;
  const nroBase = parseIntLoose(rg["CbteDesde"] ?? rg["CbteHasta"] ?? query.cbteNro) || query.cbteNro;

  const cbteFchRaw = rg["CbteFch"];
  const issueDdmmyyyy = afipYyyymmddToDdmmyyyy(cbteFchRaw, "01/01/1970");

  const fchVtoRaw = rg["FchVto"] ?? rg["CAEFchVto"];
  const caeDueDdmmyyyy = afipYyyymmddToDdmmyyyy(fchVtoRaw, issueDdmmyyyy);

  const fsd = String(rg["FchServDesde"] ?? "").replace(/\D/g, "");
  const fsh = String(rg["FchServHasta"] ?? "").replace(/\D/g, "");
  const serviceFrom =
    fsd.length >= 8 ? afipYyyymmddToDdmmyyyy(fsd, issueDdmmyyyy) : issueDdmmyyyy;
  const serviceTo =
    fsh.length >= 8 ? afipYyyymmddToDdmmyyyy(fsh, issueDdmmyyyy) : issueDdmmyyyy;

  const fvp = String(rg["FchVtoPago"] ?? "").replace(/\D/g, "");
  const paymentDue =
    fvp.length >= 8 ? afipYyyymmddToDdmmyyyy(fvp, issueDdmmyyyy) : issueDdmmyyyy;

  const impNeto = parseMoney(rg["ImpNeto"]);
  const impTotal = parseMoney(rg["ImpTotal"]);
  const impTrib = parseMoney(rg["ImpTrib"]);
  const impOpEx = parseMoney(rg["ImpOpEx"]);

  const alicList = normalizeAlicIvaRecords(rg["Iva"]);
  const items: InvoicePdfPayload["items"] =
    alicList.length > 0
      ? alicList.map((row) => {
          const id = String(row["Id"] ?? "?");
          const base = parseMoney(row["BaseImp"]);
          const imp = parseMoney(row["Importe"]);
          return {
            description: `Gravado IVA código ${id} (neto + IVA ${imp.toFixed(2)})`,
            quantity: 1,
            unit: "unidades",
            unitPrice: base,
            discountPercent: 0,
            discountAmount: 0,
            subtotal: base,
          };
        })
      : [
          {
            description: "Importe neto / operación",
            quantity: 1,
            unit: "unidades",
            unitPrice: impNeto,
            discountPercent: 0,
            discountAmount: 0,
            subtotal: impNeto,
          },
        ];

  const docTipo = parseIntLoose(rg["DocTipo"]);
  const docNro = parseIntLoose(rg["DocNro"]);
  const docNroStr = onlyDigits(String(rg["DocNro"] ?? ""));
  const receiverIvaGuess =
    DOC_RECEPTOR_IVAGUESS[docTipo] ?? "Documento receptor según AFIP";

  const vk = voucherKind(cbteTipo);
  const issuer = issuerFromEnv();

  const iibb = process.env["ARCA_PDF_ISSUER_IIBB"]?.trim();
  const activityStart = process.env["ARCA_PDF_ISSUER_ACTIVITY_START"]?.trim();

  const monedaRaw = String(rg["MonId"] ?? "PES").trim() || "PES";
  const ctz = parseMoney(rg["MonCotiz"]);
  const ctzPos = ctz > 0 ? ctz : 1;

  return {
    copyTypes: ["ORIGINAL"],
    issuer: {
      name: issuer.name,
      cuit: issuer.cuit.length >= 11 ? issuer.cuit.slice(0, 11) : issuer.cuit,
      ivaCondition: issuer.ivaCondition,
      address: issuer.address,
      ...(iibb !== undefined && iibb !== "" ? { iibb } : {}),
      ...(activityStart !== undefined && activityStart !== ""
        ? { activityStartDate: activityStart }
        : {}),
    },
    receiver: {
      name:
        docTipo === 99 && docNro === 0
          ? "Consumidor final"
          : docNroStr !== ""
            ? `Receptor (doc. ${docTipo} N° ${docNroStr})`
            : "Receptor",
      cuit: docTipo === 80 && docNroStr.length >= 11 ? docNroStr.slice(0, 11) : undefined,
      ivaCondition: receiverIvaGuess,
      address: "—",
      docTipo: docTipo > 0 ? docTipo : undefined,
      docNro: docNro >= 0 ? docNro : undefined,
    },
    voucher: {
      letter: vk.letter,
      typeName: vk.typeName,
      code: vk.code,
      cbteTipo,
      ptoVta,
      number: nroBase,
      issueDate: issueDdmmyyyy,
      serviceFrom,
      serviceTo,
      paymentDueDate: paymentDue,
      saleCondition: "—",
      cae,
      caeDueDate: caeDueDdmmyyyy,
      moneda: monedaRaw,
      ctz: ctzPos,
    },
    items,
    totals: {
      subtotal: impNeto,
      otherTaxes: impTrib + impOpEx,
      total: impTotal,
    },
  };
}

/** CAE / CodAutorización presente y no vacío. */
export function extractCaeFromConsultarResult(rg: Record<string, unknown>): string | null {
  const s = String(rg["CodAutorizacion"] ?? rg["CAE"] ?? "")
    .trim()
    .replace(/\s/g, "");
  return s !== "" ? s : null;
}
