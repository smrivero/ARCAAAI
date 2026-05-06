import type { InvoicePdfPayload, VoucherPdfPostBody } from "./invoice-models.js";

type CopyKind = "ORIGINAL" | "DUPLICADO" | "TRIPLICADO";

function onlyDigitsIss(s: string): string {
  return s.replace(/\D/g, "");
}

function trimmedOrUndef(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const s = raw.trim();
  return s === "" ? undefined : s;
}

/** Query `copies`: default solo ORIGINAL; `all` = las tres copias; o lista separada por coma. Case-insensitive. */
export function copyTypesFromQueryParam(copiesRaw: string | undefined): InvoicePdfPayload["copyTypes"] {
  const t = trimmedOrUndef(copiesRaw)?.toLowerCase();
  if (t === undefined || t === "") {
    return ["ORIGINAL"];
  }
  if (t === "all" || t === "triple" || t === "3") {
    return ["ORIGINAL", "DUPLICADO", "TRIPLICADO"];
  }
  const parts = copiesRaw!.split(",").map((x) => x.trim().toLowerCase());
  const mapped: CopyKind[] = [];
  const push = (kind: CopyKind) => {
    if (!mapped.includes(kind)) {
      mapped.push(kind);
    }
  };
  for (const p of parts) {
    if (p === "original") {
      push("ORIGINAL");
    } else if (p === "duplicado") {
      push("DUPLICADO");
    } else if (p === "triplicado") {
      push("TRIPLICADO");
    }
  }
  return mapped.length > 0 ? mapped : ["ORIGINAL"];
}

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

export function parseVoucherPdfQueryMetadata(
  q: Record<string, string | undefined>,
): VoucherPdfQueryMetadata {
  const pick = (camel: string, snake: string): string | undefined =>
    trimmedOrUndef(q[camel]) ?? trimmedOrUndef(q[snake]);

  const meta: VoucherPdfQueryMetadata = {
    copyTypes: copyTypesFromQueryParam(q["copies"]),
  };

  const issuerName = pick("issuerName", "issuer_name");
  if (issuerName !== undefined) {
    meta.issuerName = issuerName;
  }
  const issuerAddress = pick("issuerAddress", "issuer_address");
  if (issuerAddress !== undefined) {
    meta.issuerAddress = issuerAddress;
  }
  const issuerIvaCondition = pick("issuerIvaCondition", "issuer_iva_condition");
  if (issuerIvaCondition !== undefined) {
    meta.issuerIvaCondition = issuerIvaCondition;
  }
  const issuerIibb = pick("issuerIibb", "issuer_iibb");
  if (issuerIibb !== undefined) {
    meta.issuerIibb = issuerIibb;
  }
  const issuerActivityStartDate = pick("issuerActivityStartDate", "issuer_activity_start_date");
  if (issuerActivityStartDate !== undefined) {
    meta.issuerActivityStartDate = issuerActivityStartDate;
  }
  const receiverName = pick("receiverName", "receiver_name");
  if (receiverName !== undefined) {
    meta.receiverName = receiverName;
  }
  const receiverAddress = pick("receiverAddress", "receiver_address");
  if (receiverAddress !== undefined) {
    meta.receiverAddress = receiverAddress;
  }
  const receiverIvaCondition = pick("receiverIvaCondition", "receiver_iva_condition");
  if (receiverIvaCondition !== undefined) {
    meta.receiverIvaCondition = receiverIvaCondition;
  }
  const saleCondition = pick("saleCondition", "sale_condition");
  if (saleCondition !== undefined) {
    meta.saleCondition = saleCondition;
  }
  const serviceFrom = pick("serviceFrom", "service_from");
  if (serviceFrom !== undefined) {
    meta.serviceFrom = serviceFrom;
  }
  const serviceTo = pick("serviceTo", "service_to");
  if (serviceTo !== undefined) {
    meta.serviceTo = serviceTo;
  }
  const paymentDueDate = pick("paymentDueDate", "payment_due_date");
  if (paymentDueDate !== undefined) {
    meta.paymentDueDate = paymentDueDate;
  }
  const itemDescription = pick("itemDescription", "item_description");
  if (itemDescription !== undefined) {
    meta.itemDescription = itemDescription;
  }

  return meta;
}

function mergeDefined<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch) as [keyof T, T[keyof T] | undefined][]) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/** Aplica overrides comerciales encima del payload generado desde FECompConsultar. */
export function applyVoucherPdfMetadataToPayload(
  base: InvoicePdfPayload,
  meta: VoucherPdfQueryMetadata,
): InvoicePdfPayload {
  const copyTypes = meta.copyTypes ?? base.copyTypes;

  const issuer = mergeDefined(base.issuer, {
    ...(meta.issuerName !== undefined ? { name: meta.issuerName } : {}),
    ...(meta.issuerAddress !== undefined ? { address: meta.issuerAddress } : {}),
    ...(meta.issuerIvaCondition !== undefined ? { ivaCondition: meta.issuerIvaCondition } : {}),
    ...(meta.issuerIibb !== undefined ? { iibb: meta.issuerIibb } : {}),
    ...(meta.issuerActivityStartDate !== undefined
      ? { activityStartDate: meta.issuerActivityStartDate }
      : {}),
  });

  const receiver = mergeDefined(base.receiver, {
    ...(meta.receiverName !== undefined ? { name: meta.receiverName } : {}),
    ...(meta.receiverAddress !== undefined ? { address: meta.receiverAddress } : {}),
    ...(meta.receiverIvaCondition !== undefined ? { ivaCondition: meta.receiverIvaCondition } : {}),
  });

  const voucher = mergeDefined(base.voucher, {
    ...(meta.saleCondition !== undefined ? { saleCondition: meta.saleCondition } : {}),
    ...(meta.serviceFrom !== undefined ? { serviceFrom: meta.serviceFrom } : {}),
    ...(meta.serviceTo !== undefined ? { serviceTo: meta.serviceTo } : {}),
    ...(meta.paymentDueDate !== undefined ? { paymentDueDate: meta.paymentDueDate } : {}),
  });

  let items = base.items;
  if (meta.itemDescription !== undefined && items.length >= 1) {
    items = items.map((it, i) =>
      i === 0 ? { ...it, description: meta.itemDescription! } : it,
    );
  }

  return {
    ...base,
    copyTypes,
    issuer,
    receiver,
    voucher,
    items,
  };
}

/** String enviado en el body: `undefined` o solo espacios → no pisa el valor base (FE / env). */
function bodyStringOverride(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const t = raw.trim();
  return t === "" ? undefined : t;
}

/** CUIT con al menos 11 dígitos; si no, `undefined` (no pisar base). */
function bodyCuitOverride(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const d = onlyDigitsIss(raw);
  return d.length >= 11 ? d.slice(0, 11) : undefined;
}

/**
 * Base: payload fiscal desde `FECompConsultar` (`mapFeCompConsultarToInvoicePdfPayload`).
 * El body POST solo pisa campos explícitos y válidos; el resto queda del comprobante consultado.
 */
export function mergeVoucherPdfPostIntoPayload(
  base: InvoicePdfPayload,
  body: VoucherPdfPostBody,
): InvoicePdfPayload {
  const copyTypes = body.copies !== undefined ? body.copies : base.copyTypes;

  let issuer = { ...base.issuer };
  if (body.issuer !== undefined) {
    const bi = body.issuer;
    const name = bodyStringOverride(bi.name);
    if (name !== undefined) {
      issuer.name = name;
    }
    const address = bodyStringOverride(bi.address);
    if (address !== undefined) {
      issuer.address = address;
    }
    const ivaCondition = bodyStringOverride(bi.ivaCondition);
    if (ivaCondition !== undefined) {
      issuer.ivaCondition = ivaCondition;
    }
    const iibb = bodyStringOverride(bi.iibb);
    if (iibb !== undefined) {
      issuer.iibb = iibb;
    }
    const activityStartDate = bodyStringOverride(bi.activityStartDate);
    if (activityStartDate !== undefined) {
      issuer.activityStartDate = activityStartDate;
    }
    const cuitFromBody = bodyCuitOverride(bi.cuit);
    if (cuitFromBody !== undefined) {
      issuer.cuit = cuitFromBody;
    }
  }

  const issD = onlyDigitsIss(issuer.cuit);
  issuer = {
    ...issuer,
    cuit: issD.length >= 11 ? issD.slice(0, 11) : issuer.cuit.trim(),
  };

  let receiver = { ...base.receiver };
  if (body.receiver !== undefined) {
    const br = body.receiver;
    const name = bodyStringOverride(br.name);
    if (name !== undefined) {
      receiver.name = name;
    }
    const address = bodyStringOverride(br.address);
    if (address !== undefined) {
      receiver.address = address;
    }
    const ivaCondition = bodyStringOverride(br.ivaCondition);
    if (ivaCondition !== undefined) {
      receiver.ivaCondition = ivaCondition;
    }
    const cuitFromBody = bodyCuitOverride(br.cuit);
    if (cuitFromBody !== undefined) {
      receiver.cuit = cuitFromBody;
    }
  }

  let voucher = { ...base.voucher };
  if (body.voucherExtra !== undefined) {
    const vx = body.voucherExtra;
    const saleCondition = bodyStringOverride(vx.saleCondition);
    if (saleCondition !== undefined) {
      voucher.saleCondition = saleCondition;
    }
    const serviceFrom = bodyStringOverride(vx.serviceFrom);
    if (serviceFrom !== undefined) {
      voucher.serviceFrom = serviceFrom;
    }
    const serviceTo = bodyStringOverride(vx.serviceTo);
    if (serviceTo !== undefined) {
      voucher.serviceTo = serviceTo;
    }
    const paymentDueDate = bodyStringOverride(vx.paymentDueDate);
    if (paymentDueDate !== undefined) {
      voucher.paymentDueDate = paymentDueDate;
    }
    if (vx.cbu !== undefined && vx.cbu.trim() !== "") {
      voucher.cbu = vx.cbu.trim();
    }
  }

  const items = body.items !== undefined && body.items.length > 0 ? body.items : base.items;

  if (receiver.cuit !== undefined) {
    const rd = onlyDigitsIss(receiver.cuit);
    if (rd.length >= 11) {
      receiver = { ...receiver, cuit: rd.slice(0, 11) };
    }
  }

  return {
    ...base,
    copyTypes,
    issuer,
    receiver,
    voucher,
    items,
    totals: base.totals,
  };
}
