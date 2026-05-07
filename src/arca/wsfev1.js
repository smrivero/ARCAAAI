/**
 * AFIP WSFEv1 — homologación (DEV). TA vía `getValidTA()` (`src/services/arca/ta-manager.ts`).
 */
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { getValidTA } from "../services/arca/ta-manager.js";
import { loadTAFromDisk as loadTaFromWsaaDisk } from "./wsaa.js";
const FEV1_NAMESPACE = "http://ar.gov.afip.dif.FEV1/";
const SOAP_ENVELOPE_NS = "http://schemas.xmlsoap.org/soap/envelope/";
function getRequiredEnv(name) {
    const v = process.env[name];
    if (v === undefined || v === "") {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return v;
}
function sanitizeCuit(raw) {
    return raw.replace(/\D/g, "");
}
function logCredPreview(label, value) {
    const head = value.length <= 12 ? "(corto)" : `${value.slice(0, 12)}…`;
    console.log(`[wsfe] ${label} (solo prefijo):`, head);
}
export class WsfeError extends Error {
    detail;
    name = "WsfeError";
    constructor(message, detail) {
        super(message);
        this.detail = detail;
    }
}
/** TA desde `./tmp/ta.json` (lectura directa; WSFE usa `getValidTA` con renovación automática). */
export function loadTAFromDisk() {
    return loadTaFromWsaaDisk();
}
/**
 * Sobrecarga SOAP 1.1: método FEV1 y XML interno (hijos `<ar:*>` dentro de `<ar:methodName>`).
 */
export function buildSoapEnvelope(methodName, body) {
    const safeBody = body.trim();
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENVELOPE_NS}" xmlns:ar="${FEV1_NAMESPACE}">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:${methodName}>
${safeBody}
    </ar:${methodName}>
  </soapenv:Body>
</soapenv:Envelope>`;
}
function extractSoapFaultString(xml) {
    const codeM = xml.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>/i);
    const strM = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
    const code = codeM?.[1]?.trim().replace(/\s+/g, " ") ?? "";
    const msg = strM?.[1]?.trim().replace(/\s+/g, " ") ?? "";
    if (!code && !msg) {
        return null;
    }
    return [code, msg].filter(Boolean).join(" — ");
}
function findFirstKeyDeep(obj, key) {
    if (obj === null || obj === undefined) {
        return undefined;
    }
    if (typeof obj !== "object") {
        return undefined;
    }
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const v = findFirstKeyDeep(item, key);
            if (v !== undefined) {
                return v;
            }
        }
        return undefined;
    }
    const rec = obj;
    if (Object.hasOwn(rec, key)) {
        return rec[key];
    }
    for (const v of Object.values(rec)) {
        const found = findFirstKeyDeep(v, key);
        if (found !== undefined) {
            return found;
        }
    }
    return undefined;
}
/** Observaciones/errors estructura AFIP bajo cualquier `<Errors>/<Err>` en la respuesta. */
function wsfeAfipStructuredErrors(parsed) {
    const errsNode = findFirstKeyDeep(parsed, "Errors");
    if (!errsNode || typeof errsNode !== "object") {
        return [];
    }
    const rec = errsNode;
    let err = rec["Err"];
    if (err === undefined) {
        return [];
    }
    const list = Array.isArray(err) ? err : [err];
    const out = [];
    for (const item of list) {
        if (item === null || typeof item !== "object") {
            continue;
        }
        const o = item;
        const code = String(o["Code"] ?? "").trim();
        const msg = String(o["Msg"] ?? "").trim();
        if (code !== "" || msg !== "") {
            out.push(`${code}: ${msg}`);
        }
    }
    return out;
}
/**
 * Envía SOAP a WSFEv1 DEV.
 */
export async function callWSFEV1(soapEnvelope, soapAction) {
    const url = getRequiredEnv("ARCA_WSFEV1_URL_DEV");
    console.log("[wsfe] POST", url);
    console.log("[wsfe] SOAPAction:", soapAction);
    const res = await axios.post(url, soapEnvelope, {
        headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: `"${soapAction}"`,
        },
        responseType: "text",
        timeout: 60_000,
        validateStatus: () => true,
        transformResponse: [(d) => d],
    });
    const body = typeof res.data === "string" ? res.data : String(res.data);
    if (res.status !== 200) {
        const fault = extractSoapFaultString(body);
        throw new WsfeError(fault ?? `WSFE HTTP ${String(res.status)}`, body.slice(0, 800));
    }
    const faultText = extractSoapFaultString(body);
    if (faultText) {
        throw new WsfeError(`SOAP Fault: ${faultText}`, body.slice(0, 800));
    }
    return body;
}
const responseParser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
    processEntities: true,
});
function parseSoapToRecord(xml) {
    try {
        return responseParser.parse(xml);
    }
    catch (e) {
        throw new WsfeError(`XML WSFE ilegible: ${e instanceof Error ? e.message : String(e)}`, xml.slice(0, 600));
    }
}
/** Parse genérico de respuesta WSFE (Fault HTTP ya tratado en `callWSFEV1`). */
export function parseWsfeSoapXml(xml) {
    const parsed = parseSoapToRecord(xml);
    const errs = wsfeAfipStructuredErrors(parsed);
    if (errs.length > 0) {
        throw new WsfeError(`AFIP Errors: ${errs.join("; ")}`, parsed);
    }
    return parsed;
}
function requireSoapRecord(value, ctx) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    throw new WsfeError(ctx);
}
/**
 * Nodo real AFIP: Envelope.Body.FECompUltimoAutorizadoResponse.FECompUltimoAutorizadoResult
 * (sin `ResultGet`; campos PtoVta, CbteTipo, CbteNro).
 */
function getFeCompUltimoAutorizadoResult(parsed) {
    const envelope = requireSoapRecord(parsed["Envelope"], "FECompUltimoAutorizado: falta nodo Envelope.");
    const body = requireSoapRecord(envelope["Body"], "FECompUltimoAutorizado: falta Body.");
    const response = requireSoapRecord(body["FECompUltimoAutorizadoResponse"], "FECompUltimoAutorizado: falta FECompUltimoAutorizadoResponse.");
    return requireSoapRecord(response["FECompUltimoAutorizadoResult"], "FECompUltimoAutorizado: falta FECompUltimoAutorizadoResult.");
}
function getFeCompConsultarSoapResult(parsed) {
    const envelope = requireSoapRecord(parsed["Envelope"], "FECompConsultar: falta nodo Envelope.");
    const body = requireSoapRecord(envelope["Body"], "FECompConsultar: falta Body.");
    const response = requireSoapRecord(body["FECompConsultarResponse"], "FECompConsultar: falta FECompConsultarResponse.");
    return requireSoapRecord(response["FECompConsultarResult"], "FECompConsultar: falta FECompConsultarResult.");
}
function throwIfFeCompUltimoResultHasAfipErrors(result) {
    const errorsNode = result["Errors"];
    if (errorsNode === undefined || errorsNode === null) {
        return;
    }
    const msgs = wsfeAfipStructuredErrors({ Errors: errorsNode });
    if (msgs.length > 0) {
        throw new WsfeError(`FECompUltimoAutorizado: AFIP devolvió errores en FECompUltimoAutorizadoResult: ${msgs.join("; ")}`, result);
    }
}
async function loadTaAndCuitForWsfe() {
    try {
        const ta = await getValidTA();
        const cuitRaw = process.env["ARCA_CUIT"];
        if (!cuitRaw || cuitRaw.trim() === "") {
            throw new WsfeError("Missing ARCA_CUIT in environment.");
        }
        const cuit = sanitizeCuit(cuitRaw);
        if (cuit.length < 11) {
            throw new WsfeError("ARCA_CUIT inválido (solo dígitos, 11 caracteres esperados para CUIT).");
        }
        return { ta, cuit };
    }
    catch (err) {
        if (err instanceof WsfeError) {
            throw err;
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new WsfeError(`No se pudo obtener TA para WSFE: ${msg}`, err);
    }
}
function buildAuthBlock(ta, cuit, opts) {
    if (opts?.logPreview !== false) {
        logCredPreview("Token TA", ta.token);
        logCredPreview("Sign TA", ta.sign);
    }
    return `    <ar:Auth>
      <ar:Token>${escapeXmlText(ta.token)}</ar:Token>
      <ar:Sign>${escapeXmlText(ta.sign)}</ar:Sign>
      <ar:Cuit>${escapeXmlText(cuit)}</ar:Cuit>
    </ar:Auth>`;
}
function escapeXmlText(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Último comprobante autorizado para punto de venta y tipo de comprobante. */
export async function feCompUltimoAutorizado(params, options) {
    const { ta, cuit } = await loadTaAndCuitForWsfe();
    const logPreview = options?.logCredentialPreview !== false;
    const innerXml = `${buildAuthBlock(ta, cuit, { logPreview })}
    <ar:PtoVta>${String(params.ptoVta)}</ar:PtoVta>
    <ar:CbteTipo>${String(params.cbteTipo)}</ar:CbteTipo>`;
    const envelope = buildSoapEnvelope("FECompUltimoAutorizado", innerXml);
    const action = `${FEV1_NAMESPACE}FECompUltimoAutorizado`;
    const xml = await callWSFEV1(envelope, action);
    const parsed = parseSoapToRecord(xml);
    const result = getFeCompUltimoAutorizadoResult(parsed);
    throwIfFeCompUltimoResultHasAfipErrors(result);
    if (!options?.quietConsole) {
        console.log("[wsfe] FECompUltimoAutorizado debug:", {
            PtoVta: result["PtoVta"],
            CbteTipo: result["CbteTipo"],
            CbteNro: result["CbteNro"],
        });
    }
    return parsed;
}
const FE_COMP_CONSULTAR_NOT_FOUND_CODES = new Set([602]);
const YYYYMMDD_REGEX = /^\d{8}$/;
const DEFAULT_WSFE_LIST_LIMIT = 20;
const MAX_WSFE_LIST_LIMIT = 100;
/** Evita llamar `FECompConsultar` indefinidamente si la numeración es muy alta / hay grandes huecos. */
const MAX_WSFE_LIST_SCAN_ITERATIONS = 5000;
function normalizeConsultarResultGet(node) {
    if (node === undefined || node === null) {
        return null;
    }
    const first = Array.isArray(node) ? node[0] : node;
    if (first === null || typeof first !== "object" || Array.isArray(first)) {
        return null;
    }
    return first;
}
function feCompConsultarResultErrorMessages(result) {
    const errorsNode = result["Errors"];
    if (errorsNode === undefined || errorsNode === null) {
        return [];
    }
    return wsfeAfipStructuredErrors({ Errors: errorsNode });
}
function consultarHasMeaningfulResultGet(rg) {
    if (!rg || Object.keys(rg).length === 0) {
        return false;
    }
    const keys = Object.keys(rg);
    /** Campos típicos de `ResultGet` en FECompConsultar (afip doc / afipjs). */
    const markers = ["CodAutorizacion", "CbteDesde", "ImpTotal", "Resultado", "CAE", "CbteFch"];
    return markers.some((m) => keys.includes(m));
}
function isConsultarSkippedNotFound(errs) {
    if (errs.length === 0) {
        return false;
    }
    const text = errs.join(" ").toLowerCase();
    if (/inexistente|no existe|no se encontr|sin comprobante|sin comprobantes|no corresponde un comprobante/.test(text)) {
        return true;
    }
    for (const err of errs) {
        const codeMatch = /^(\d+)\s*:/.exec(err);
        const codeStr = codeMatch?.[1];
        if (codeStr !== undefined &&
            FE_COMP_CONSULTAR_NOT_FOUND_CODES.has(Number.parseInt(codeStr, 10))) {
            return true;
        }
    }
    return false;
}
/** Interpreta `FECompConsultarResult`; devuelve clon de `ResultGet` o null si AFIP indica que no existe. */
function interpretFeCompConsultarSoap(parsed) {
    const result = getFeCompConsultarSoapResult(parsed);
    const errsMsgs = feCompConsultarResultErrorMessages(result);
    const rg = normalizeConsultarResultGet(result["ResultGet"]);
    if (consultarHasMeaningfulResultGet(rg)) {
        return { ...rg };
    }
    if (errsMsgs.length === 0) {
        throw new WsfeError("FECompConsultar: respuesta sin datos de comprobante ni errores explicados.", result);
    }
    if (isConsultarSkippedNotFound(errsMsgs)) {
        return null;
    }
    throw new WsfeError(`FECompConsultar: ${errsMsgs.join("; ")}`, result);
}
/**
 * Consulta un comprobante emitido (`FECompConsultar`).
 * No loguea token/sign (`logPreview` en Auth).
 *
 * @returns Clon liviano del `ResultGet` de AFIP, o null si no hay comprobante (hueco / número inexistente).
 */
export async function feCompConsultar(params) {
    const { ta, cuit } = await loadTaAndCuitForWsfe();
    const innerXml = `${buildAuthBlock(ta, cuit, { logPreview: false })}
    <ar:FeCompConsReq>
      <ar:CbteTipo>${String(params.cbteTipo)}</ar:CbteTipo>
      <ar:CbteNro>${String(params.cbteNro)}</ar:CbteNro>
      <ar:PtoVta>${String(params.ptoVta)}</ar:PtoVta>
    </ar:FeCompConsReq>`;
    const envelope = buildSoapEnvelope("FECompConsultar", innerXml);
    const action = `${FEV1_NAMESPACE}FECompConsultar`;
    const xml = await callWSFEV1(envelope, action);
    const parsed = parseSoapToRecord(xml);
    return interpretFeCompConsultarSoap(parsed);
}
function voucherCbteFchInRange(voucher, fromDate, toDate) {
    if (fromDate === undefined && toDate === undefined) {
        return true;
    }
    const raw = voucher["CbteFch"];
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (!YYYYMMDD_REGEX.test(digits)) {
        return false;
    }
    if (fromDate !== undefined) {
        if (!YYYYMMDD_REGEX.test(fromDate)) {
            return false;
        }
        if (digits < fromDate) {
            return false;
        }
    }
    if (toDate !== undefined) {
        if (!YYYYMMDD_REGEX.test(toDate)) {
            return false;
        }
        if (digits > toDate) {
            return false;
        }
    }
    return true;
}
/**
 * Lista comprobantes hacia atrás desde el último autorizado: hasta `limit` encontrados (`FECompConsultar`)
 * sin recorrer más allá del número 1.
 * Opcionalmente filtra por fecha de emisión (`CbteFch` yyyymmdd).
 * Las credenciales no se loguean en este flujo (`FECompUltimoAutorizado` + `FECompConsultar` sin previews).
 */
export async function listWsfeVouchers(params) {
    const limit = params.limit === undefined
        ? DEFAULT_WSFE_LIST_LIMIT
        : Math.min(Math.max(1, params.limit), MAX_WSFE_LIST_LIMIT);
    const ultimoParsed = await feCompUltimoAutorizado({ ptoVta: params.ptoVta, cbteTipo: params.cbteTipo }, { logCredentialPreview: false, quietConsole: true });
    const lastVoucherNumber = extractCbteNroFromUltimoResponse(ultimoParsed);
    const collected = [];
    let scans = 0;
    for (let n = lastVoucherNumber; n >= 1 &&
        collected.length < limit &&
        scans < MAX_WSFE_LIST_SCAN_ITERATIONS; n -= 1, scans += 1) {
        const row = await feCompConsultar({
            ptoVta: params.ptoVta,
            cbteTipo: params.cbteTipo,
            cbteNro: n,
        });
        if (row !== null) {
            collected.push(row);
        }
    }
    const vouchers = params.fromDate === undefined && params.toDate === undefined
        ? collected
        : collected.filter((v) => voucherCbteFchInRange(v, params.fromDate, params.toDate));
    return {
        ok: true,
        ptoVta: params.ptoVta,
        cbteTipo: params.cbteTipo,
        lastVoucherNumber,
        count: vouchers.length,
        vouchers,
    };
}
export const createVoucherBodySchema = z
    .object({
    ptoVta: z.number().int().min(1).max(99999),
    cbteTipo: z.number().int().min(1),
    concepto: z.number().int().min(1).max(3),
    docTipo: z.number().int(),
    docNro: z.number().int(),
    impTotal: z.number().nonnegative(),
    impNeto: z.number().nonnegative(),
    impIVA: z.number().nonnegative(),
    monId: z.string().min(1),
    monCotiz: z.number().positive(),
    iva: z
        .array(z.object({
        id: z.number().int(),
        baseImp: z.number().nonnegative(),
        importe: z.number().nonnegative(),
    }))
        .min(1),
    /** Obligatorio salvo DocTipo 99 (CF): ahí puede omitirse y se usa 5. */
    condicionIVAReceptorId: z.number().int().optional(),
})
    .refine((d) => d.condicionIVAReceptorId !== undefined || d.docTipo === 99, {
    message: "condicionIVAReceptorId es obligatorio salvo DocTipo 99 (consumidor final): en ese caso puede omitirse y se asume 5.",
    path: ["condicionIVAReceptorId"],
})
    .transform((d) => ({
    ...d,
    condicionIVAReceptorId: d.condicionIVAReceptorId ?? 5,
}));
function todayYyyyMmDdArgentina() {
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Argentina/Buenos_Aires",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date());
    const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
    return `${g("year")}${g("month")}${g("day")}`;
}
function formatAmount2(n) {
    return n.toFixed(2);
}
export function extractCbteNroFromUltimoResponse(parsed) {
    const result = getFeCompUltimoAutorizadoResult(parsed);
    const raw = result["CbteNro"];
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        throw new WsfeError(`FECompUltimoAutorizado: CbteNro inválido o ausente: ${String(raw)}`);
    }
    return Math.trunc(n);
}
function normalizeErrList(errNode) {
    if (errNode === undefined || errNode === null) {
        return [];
    }
    const list = Array.isArray(errNode) ? errNode : [errNode];
    return list.filter((x) => x !== null && typeof x === "object");
}
/** Recorre el árbol y junta mensajes de nodos `Err` con Code+Msg. */
function collectAllErrMessages(obj) {
    const out = [];
    function walk(o) {
        if (o === null || o === undefined) {
            return;
        }
        if (typeof o !== "object") {
            return;
        }
        if (Array.isArray(o)) {
            for (const x of o)
                walk(x);
            return;
        }
        const rec = o;
        if (Object.hasOwn(rec, "Err")) {
            for (const item of normalizeErrList(rec["Err"])) {
                const code = String(item["Code"] ?? item["code"] ?? "").trim();
                const msg = String(item["Msg"] ?? item["msg"] ?? "").trim();
                if (code !== "" || msg !== "") {
                    out.push(`${code}: ${msg}`);
                }
            }
        }
        for (const v of Object.values(rec)) {
            walk(v);
        }
    }
    walk(obj);
    return out;
}
/** Prefer `FECAEDetResponse`; fallback a `FECAEADetailResponse` (variantes SOAP). */
function firstFecaDetLikeResponse(raw) {
    const preferOrder = ["FECAEDetResponse", "FECAEADetailResponse"];
    for (const key of preferOrder) {
        const node = findFirstKeyDeep(raw, key);
        if (node === undefined || node === null) {
            continue;
        }
        const first = Array.isArray(node) ? node[0] : node;
        if (first !== null && typeof first === "object") {
            return first;
        }
    }
    return null;
}
/** Misma forma que errores AFIP bajo Observaciones/Observations: uno o varios `<Obs>` con Code/Msg. */
function observacionesNodeToStrings(observationsNode) {
    if (observationsNode === undefined || observationsNode === null) {
        return [];
    }
    if (typeof observationsNode !== "object") {
        const s = String(observationsNode).trim();
        return s !== "" ? [s] : [];
    }
    const rec = observationsNode;
    const obsEl = rec["Obs"];
    const out = [];
    for (const item of normalizeErrList(obsEl)) {
        const code = String(item["Code"] ?? item["code"] ?? "").trim();
        const msg = String(item["Msg"] ?? item["msg"] ?? "").trim();
        if (code !== "" || msg !== "") {
            out.push(`${code}: ${msg}`);
        }
    }
    return out;
}
function toNullableString(v) {
    if (v === undefined || v === null) {
        return null;
    }
    const s = String(v).trim();
    return s !== "" ? s : null;
}
function toNullableInt(v) {
    if (v === undefined || v === null || v === "") {
        return null;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
        return null;
    }
    return Math.trunc(n);
}
export function distillFecaSolicitarResponse(raw) {
    const errors = collectAllErrMessages(raw);
    const detail = firstFecaDetLikeResponse(raw);
    let voucherNumber = null;
    let cae = null;
    let caeDueDate = null;
    let result = null;
    const observations = [];
    if (detail) {
        voucherNumber = toNullableInt(detail["CbteDesde"] ?? detail["CbteHasta"]);
        cae = toNullableString(detail["CAE"]);
        caeDueDate = toNullableString(detail["CAEFchVto"]);
        result = toNullableString(detail["Resultado"]);
        observations.push(...observacionesNodeToStrings(detail["Observaciones"]), ...observacionesNodeToStrings(detail["Observations"]));
    }
    return {
        voucherNumber,
        cae,
        caeDueDate,
        result,
        observations,
        errors,
        raw,
    };
}
function buildAlicIvaXml(rows) {
    return rows
        .map((row) => `          <ar:AlicIva>
            <ar:Id>${String(row.id)}</ar:Id>
            <ar:BaseImp>${escapeXmlText(formatAmount2(row.baseImp))}</ar:BaseImp>
            <ar:Importe>${escapeXmlText(formatAmount2(row.importe))}</ar:Importe>
          </ar:AlicIva>`)
        .join("\n");
}
function buildFeCAEReqInner(input, nextNumber, cbteFch) {
    const alic = buildAlicIvaXml(input.iva);
    return `    <ar:FeCAEReq>
      <ar:FeCabReq>
        <ar:CantReg>1</ar:CantReg>
        <ar:PtoVta>${String(input.ptoVta)}</ar:PtoVta>
        <ar:CbteTipo>${String(input.cbteTipo)}</ar:CbteTipo>
      </ar:FeCabReq>
      <ar:FeDetReq>
        <ar:FECAEDetRequest>
          <ar:Concepto>${String(input.concepto)}</ar:Concepto>
          <ar:DocTipo>${String(input.docTipo)}</ar:DocTipo>
          <ar:DocNro>${String(input.docNro)}</ar:DocNro>
          <ar:CbteDesde>${String(nextNumber)}</ar:CbteDesde>
          <ar:CbteHasta>${String(nextNumber)}</ar:CbteHasta>
          <ar:CbteFch>${escapeXmlText(cbteFch)}</ar:CbteFch>
          <ar:ImpTotal>${escapeXmlText(formatAmount2(input.impTotal))}</ar:ImpTotal>
          <ar:ImpTotConc>0</ar:ImpTotConc>
          <ar:ImpNeto>${escapeXmlText(formatAmount2(input.impNeto))}</ar:ImpNeto>
          <ar:ImpOpEx>0</ar:ImpOpEx>
          <ar:ImpTrib>0</ar:ImpTrib>
          <ar:ImpIVA>${escapeXmlText(formatAmount2(input.impIVA))}</ar:ImpIVA>
          <ar:MonId>${escapeXmlText(input.monId)}</ar:MonId>
          <ar:MonCotiz>${escapeXmlText(formatAmount2(input.monCotiz))}</ar:MonCotiz>
          <ar:CondicionIVAReceptorId>${String(input.condicionIVAReceptorId)}</ar:CondicionIVAReceptorId>
          <ar:Iva>
${alic}
          </ar:Iva>
        </ar:FECAEDetRequest>
      </ar:FeDetReq>
    </ar:FeCAEReq>`;
}
/**
 * Homologación: Factura B mínima vía FECAESolicitar (después de FECompUltimoAutorizado).
 */
export async function feCAESolicitar(input) {
    const { ta, cuit } = await loadTaAndCuitForWsfe();
    const ultimo = await feCompUltimoAutorizado({
        ptoVta: input.ptoVta,
        cbteTipo: input.cbteTipo,
    });
    const lastNro = extractCbteNroFromUltimoResponse(ultimo);
    const nextNumber = lastNro + 1;
    const cbteFch = todayYyyyMmDdArgentina();
    console.log("[wsfe] FECAESolicitar: último CbteNro=", lastNro, "siguiente=", nextNumber, "CbteFch=", cbteFch);
    const innerXml = `${buildAuthBlock(ta, cuit)}
${buildFeCAEReqInner(input, nextNumber, cbteFch)}`;
    const envelope = buildSoapEnvelope("FECAESolicitar", innerXml);
    console.log("[wsfe] FECAESolicitar SOAP XML (debug temporal):\n", envelope);
    const action = `${FEV1_NAMESPACE}FECAESolicitar`;
    const xml = await callWSFEV1(envelope, action);
    const raw = parseSoapToRecord(xml);
    return distillFecaSolicitarResponse(raw);
}
//# sourceMappingURL=wsfev1.js.map