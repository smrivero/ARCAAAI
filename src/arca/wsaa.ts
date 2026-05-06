/**
 * AFIP WSAA LoginCms (homologación / desarrollo).
 * Firma PKCS#7 del TRA vía ejecutable `openssl` del sistema (subcomando `cms`).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";

const MS = 60_000;
/** Archivo TA para desarrollo (relativo al cwd del proceso). */
const TA_DISK_PATH = path.join(process.cwd(), "tmp", "ta.json");
/** Margen antes del vencimiento AFIP para considerar el TA caducado. */
const TA_EXPIRY_SAFETY_BUFFER_MS = 120_000;
/** Fallback si no se puede parsear expirationTime (~12 h). */
const TA_FALLBACK_TTL_MS = 12 * 60 * MS;

export class WsaaAlreadyAuthenticatedError extends Error {
  override readonly name = "WsaaAlreadyAuthenticatedError";
  constructor() {
    super("WSAA declined new login because a TA is already valid for this certificate.");
  }
}

/** TA persistido / devuelto por WSAA (loginTicketResponse). */
export type WsaaTicketAccess = {
  token: string;
  sign: string;
  generationTime: string;
  expirationTime: string;
};

type CachedTa = WsaaTicketAccess & { expiresAtMs: number };

let taMemoryCache: CachedTa | null = null;

function getRequiredEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

/** Fecha/hora en formato ISO 8601 con offset fijo -03:00 (Argentina). */
export function formatAfipDateTime(d: Date): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}.${ms}-03:00`;
}

/**
 * Genera el XML del Ticket de Requerimiento de Acceso (TRA).
 *
 * @param service - Servicio AFIP (ej. wsfe). Por defecto desde env o `wsfe`.
 */
export function createLoginTicketRequest(service?: string): string {
  const now = Date.now();
  const uniqueId = String(Math.floor(now / 1000));
  const generationTime = formatAfipDateTime(new Date(now - 10 * MS));
  const expirationTime = formatAfipDateTime(new Date(now + 10 * MS));
  const svc = service ?? (process.env["ARCA_WSAA_SERVICE"]?.trim() || "wsfe");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>${svc}</service>
</loginTicketRequest>`;

  console.log("[wsaa] createLoginTicketRequest:", {
    uniqueId,
    service: svc,
    generationTime,
    expirationTimeTra: expirationTime,
  });

  return xml;
}

/**
 * Firma el contenido XML con CMS (PKCS#7) en formato DER usando OpenSSL CLI.
 * Requiere `openssl` instalado y accesible en PATH.
 */
export function signCMS(xmlContent: string, certPath: string, keyPath: string): Buffer {
  console.log("[wsaa] signCMS: certPath=", certPath, "keyPath=", keyPath);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "afip-wsaa-"));
  const xmlFile = path.join(tmpDir, "LoginTicketRequest.xml");
  const outFile = path.join(tmpDir, "LoginTicketRequest.cms");

  try {
    fs.writeFileSync(xmlFile, xmlContent, "utf8");

    const result = spawnSync(
      "openssl",
      [
        "cms",
        "-sign",
        "-in",
        xmlFile,
        "-signer",
        certPath,
        "-inkey",
        keyPath,
        "-nodetach",
        "-outform",
        "DER",
        "-out",
        outFile,
      ],
      { encoding: "utf-8" },
    );

    if (result.error) {
      console.error("[wsaa] signCMS: spawn error", result.error);
      throw result.error;
    }
    if (result.status !== 0) {
      const msg = (result.stderr ?? result.stdout ?? "").trim();
      console.error("[wsaa] signCMS: openssl failed:", msg);
      throw new Error(
        `openssl cms -sign failed (exit ${String(result.status)}). Revisá certificado, clave y que OpenSSL esté en PATH. ${msg}`,
      );
    }

    const der = fs.readFileSync(outFile);
    console.log("[wsaa] signCMS: DER bytes=", der.length);
    return der;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function extractSoapFaultDetails(soapXml: string): { code: string; string: string } | null {
  if (!/<fault/i.test(soapXml)) {
    return null;
  }
  const codeM = soapXml.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>/i);
  const strM = soapXml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
  const code = codeM?.[1]?.trim().replace(/\s+/g, " ") ?? "";
  const str = strM?.[1]?.trim().replace(/\s+/g, " ") ?? "";
  if (!code && !str) {
    return null;
  }
  return { code, string: str };
}

function isAlreadyAuthenticatedFault(details: { code: string; string: string }): boolean {
  const combined = `${details.code} ${details.string}`.toLowerCase();
  return (
    combined.includes("alreadyauthenticated") ||
    combined.includes("coe.alreadyauthenticated") ||
    combined.includes("already_authenticated") ||
    /coe\s*[,.\s-]*alreadyauthenticated/i.test(combined)
  );
}

function unwrapCdata(inner: string): string {
  return inner.trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

/** Decodifica entidades típicas cuando AFIP serializa XML escapado dentro de SOAP. */
function decodeXmlEntitiesRough(s: string): string {
  let out = s;
  let prev = "";
  for (let i = 0; i < 6 && prev !== out; i++) {
    prev = out;
    out = out.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    );
    out = out.replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    );
    out = out.replace(/&lt;/gi, "<");
    out = out.replace(/&gt;/gi, ">");
    out = out.replace(/&quot;/gi, '"');
    out = out.replace(/&apos;/gi, "'");
    out = out.replace(/&amp;/g, "&");
  }
  return out;
}

function stripXmlPi(s: string): string {
  return s.replace(/^<\?xml\b[\s\S]*?\?>[\s\n]*/, "").trim();
}

/**
 * Fragmento dentro de `<loginCmsReturn>` → XML usable (CDATA, entidades, PI).
 */
function normalizeLoginTicketXml(fragment: string): string {
  let s = unwrapCdata(fragment.trim());
  if (/&(?:lt|gt|amp|quot|apos|[#])/i.test(s)) {
    s = decodeXmlEntitiesRough(s);
  }
  s = stripXmlPi(s).trim();
  return s;
}

function extractXmlTagInner(xml: string, tag: string): string | undefined {
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${esc}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${esc}>`,
    "i",
  );
  const m = xml.match(re);
  const inner = unwrapCdata(m?.[1]?.trim() ?? "");
  return inner !== "" ? inner : undefined;
}

function coerceXmlLeafText(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t !== "" ? t : undefined;
  }
  if (v === null || v === undefined || typeof v !== "object" || Array.isArray(v)) {
    return undefined;
  }
  const o = v as Record<string, unknown>;
  if (typeof o["#text"] === "string") {
    const t = o["#text"].trim();
    return t !== "" ? t : undefined;
  }
  return undefined;
}

function extractExpirationTimeFromXml(xml: string): string | undefined {
  const matches = [...xml.matchAll(/<expirationTime[^>]*>([\s\S]*?)<\/expirationTime>/gi)];
  const values = matches.map((m) => unwrapCdata(m[1] ?? "")).filter(Boolean) as string[];
  return values.at(-1);
}

function extractGenerationTimeFromXml(xml: string): string | undefined {
  const matches = [...xml.matchAll(/<generationTime[^>]*>([\s\S]*?)<\/generationTime>/gi)];
  const values = matches.map((m) => unwrapCdata(m[1] ?? "")).filter(Boolean) as string[];
  return values.at(-1);
}

/** Carga `./tmp/ta.json`. Devuelve null si falta archivo, JSON inválido o formato incorrecto. */
export function loadTAFromDisk(): WsaaTicketAccess | null {
  try {
    if (!fs.existsSync(TA_DISK_PATH)) {
      return null;
    }
    const raw = fs.readFileSync(TA_DISK_PATH, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (data === null || typeof data !== "object") {
      return null;
    }
    const rec = data as Record<string, unknown>;
    const token = typeof rec["token"] === "string" ? rec["token"] : "";
    const sign = typeof rec["sign"] === "string" ? rec["sign"] : "";
    const generationTime =
      typeof rec["generationTime"] === "string" ? rec["generationTime"] : "";
    const expirationTime =
      typeof rec["expirationTime"] === "string" ? rec["expirationTime"] : "";

    if (token === "" || sign === "" || expirationTime === "") {
      return null;
    }

    return { token, sign, generationTime, expirationTime };
  } catch {
    return null;
  }
}

/** Guarda TA en `./tmp/ta.json` (solo dev). Sync. */
export function saveTAToDisk(ta: WsaaTicketAccess): void {
  const dir = path.dirname(TA_DISK_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const payload = `${JSON.stringify(ta, null, 2)}\n`;
  fs.writeFileSync(TA_DISK_PATH, payload, "utf8");
  const st = fs.statSync(TA_DISK_PATH);
  console.log("[wsaa] TA escrito en disco:", TA_DISK_PATH, "| bytes:", st.size);
}

/** Convierte el valor de expirationTime del TA a milliseconds (UTC). Devuelve null si no parsea. */
export function parseAfipTaExpirationToMs(expirationTime: string): number | null {
  const trimmed = expirationTime.trim();
  if (!trimmed) {
    return null;
  }

  let parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  const m = trimmed.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?([+-]\d{2}:\d{2}|[+-]\d{4}|Z)?$/,
  );
  if (!m) {
    return null;
  }

  const [, y, mo, d, h, mi, s, frac, tzRaw] = m;
  const fracPart = frac !== undefined ? `.${frac}` : "";
  let iso: string;
  if (tzRaw === "Z") {
    iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${fracPart}Z`;
  } else if (tzRaw !== undefined && tzRaw !== "") {
    const tz = tzRaw.includes(":") ? tzRaw : `${tzRaw.slice(0, 3)}:${tzRaw.slice(3)}`;
    iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${fracPart}${tz}`;
  } else {
    iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${fracPart}-03:00`;
  }

  parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function computeCacheDeadlineMs(expirationTimeRaw: string, fetchedAtMs: number): number {
  const parsed = parseAfipTaExpirationToMs(expirationTimeRaw);
  if (parsed === null) {
    console.warn(
      "[wsaa] No se pudo parsear expirationTime del TA; uso TTL aproximado de 12 h para la caché.",
    );
    return fetchedAtMs + TA_FALLBACK_TTL_MS - TA_EXPIRY_SAFETY_BUFFER_MS;
  }
  return parsed - TA_EXPIRY_SAFETY_BUFFER_MS;
}

/** Verdadero si el TA ya no debe usarse (incluye margen de seguridad ante expirationTime). */
export function isTAExpired(expirationTime: string): boolean {
  const expMs = parseAfipTaExpirationToMs(expirationTime);
  if (expMs === null) {
    return true;
  }
  const deadline = expMs - TA_EXPIRY_SAFETY_BUFFER_MS;
  return Date.now() >= deadline;
}

/** Recorre el árbol parseado y devuelve token/sign si existen como strings (#text inclusive). */
function findTokenSignDeep(obj: unknown): { token?: string; sign?: string } {
  let token: string | undefined;
  let sign: string | undefined;

  function walk(o: unknown): void {
    if (o === null || o === undefined) return;
    if (typeof o !== "object") return;
    if (Array.isArray(o)) {
      for (const item of o) walk(item);
      return;
    }
    const rec = o as Record<string, unknown>;
    const t = coerceXmlLeafText(rec["token"]);
    if (t !== undefined && token === undefined) {
      token = t;
    }
    const s = coerceXmlLeafText(rec["sign"]);
    if (s !== undefined && sign === undefined) {
      sign = s;
    }
    for (const v of Object.values(rec)) walk(v);
  }

  walk(obj);
  const out: { token?: string; sign?: string } = {};
  if (token !== undefined) out.token = token;
  if (sign !== undefined) out.sign = sign;
  return out;
}

function credentialsFromRegex(innerXml: string): {
  token?: string;
  sign?: string;
  generationTime?: string;
  expirationTime?: string;
} {
  const token = extractXmlTagInner(innerXml, "token");
  const sign = extractXmlTagInner(innerXml, "sign");
  const generationTime = extractXmlTagInner(innerXml, "generationTime");
  const expirationTime = extractXmlTagInner(innerXml, "expirationTime");

  const out: {
    token?: string;
    sign?: string;
    generationTime?: string;
    expirationTime?: string;
  } = {};
  if (token !== undefined) out.token = token;
  if (sign !== undefined) out.sign = sign;
  if (generationTime !== undefined) out.generationTime = generationTime;
  if (expirationTime !== undefined) out.expirationTime = expirationTime;
  return out;
}

/**
 * Parsea la respuesta SOAP de loginCms y extrae token, sign, generationTime y expirationTime del TA.
 */
export function parseWSAAResponse(soapXml: string): WsaaTicketAccess {
  console.log("[wsaa] parseWSAAResponse: respuesta SOAP, bytes=", soapXml.length);

  const faultDetails = extractSoapFaultDetails(soapXml);
  if (faultDetails) {
    const faultSummary = [faultDetails.code, faultDetails.string].filter(Boolean).join(" — ");
    if (isAlreadyAuthenticatedFault(faultDetails)) {
      console.warn("[wsaa] WSAA fault: TA ya autenticado (coe.alreadyAuthenticated).");
      throw new WsaaAlreadyAuthenticatedError();
    }
    console.error("[wsaa] WSAA SOAP Fault:", faultSummary);
    throw new Error(`WSAA SOAP Fault: ${faultSummary}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
    processEntities: true,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(soapXml);
  } catch (e) {
    console.error("[wsaa] parseWSAAResponse: error parseando XML", e);
    throw new Error(`Invalid WSAA SOAP XML: ${e instanceof Error ? e.message : String(e)}`);
  }

  const expirationFromSoap = extractExpirationTimeFromXml(soapXml);
  const generationFromSoap = extractGenerationTimeFromXml(soapXml);

  const deep = findTokenSignDeep(parsed);
  if (deep.token !== undefined && deep.sign !== undefined) {
    const expirationTime = expirationFromSoap ?? "";
    const generationTime = generationFromSoap ?? "";
    if (!expirationTime || !generationTime) {
      throw new Error("WSAA: respuesta sin generationTime / expirationTime reconocibles");
    }
    console.log("[wsaa] parseWSAAResponse: loginTicket parseado desde SOAP");
    return { token: deep.token, sign: deep.sign, generationTime, expirationTime };
  }

  const innerMatch = soapXml.match(
    /<(?:[\w.-]+:)?loginCmsReturn[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?loginCmsReturn>/i,
  );
  if (innerMatch?.[1]) {
    const normalized = normalizeLoginTicketXml(innerMatch[1]);
    console.log(
      "[wsaa] parseWSAAResponse: loginCmsReturn normalizado, bytes=",
      normalized.length,
    );

    let innerParsed: unknown = null;
    try {
      innerParsed = parser.parse(normalized);
    } catch (e) {
      console.warn(
        "[wsaa] parse WSAA falló sobre loginTicket normalizado; se intenta solo regex",
      );
    }

    const innerDeep =
      innerParsed !== null ? findTokenSignDeep(innerParsed) : { token: undefined, sign: undefined };
    const rx = credentialsFromRegex(normalized);

    const token = innerDeep.token ?? rx.token;
    const sign = innerDeep.sign ?? rx.sign;
    const expirationTime =
      rx.expirationTime ??
      extractExpirationTimeFromXml(normalized) ??
      extractExpirationTimeFromXml(soapXml) ??
      "";
    const generationTime =
      rx.generationTime ??
      extractGenerationTimeFromXml(normalized) ??
      extractGenerationTimeFromXml(soapXml) ??
      "";

    if (token !== undefined && sign !== undefined && expirationTime !== "" && generationTime !== "") {
      console.log("[wsaa] parseWSAAResponse: loginTicket desde loginCmsReturn");
      return {
        token,
        sign,
        generationTime,
        expirationTime,
      };
    }
  }

  console.error("[wsaa] parseWSAAResponse: no se encontraron token/sign en la respuesta");
  throw new Error("Could not parse token/sign from WSAA loginCms response");
}

function buildLoginCmsSoapEnvelope(cmsBase64: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:wsaa="http://ar.gov.afip.dif.facturaelectronica/">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Llama siempre a WSAA (sin caché). Útil para pruebas o forzar renovación.
 */
export async function fetchWsaaLoginTicket(): Promise<WsaaTicketAccess> {
  const wsaaUrl = getRequiredEnv("ARCA_WSAA_URL_DEV");
  const certPath = getRequiredEnv("ARCA_CERT_PATH");
  const keyPath = getRequiredEnv("ARCA_KEY_PATH");
  const cuit = process.env["ARCA_CUIT"];
  console.log("[wsaa] fetchWsaaLoginTicket: URL=", wsaaUrl, "CUIT=", cuit ?? "(not set)");

  const traXml = createLoginTicketRequest();
  const cmsDer = signCMS(traXml, certPath, keyPath);
  const cmsBase64 = cmsDer.toString("base64");
  console.log("[wsaa] fetchWsaaLoginTicket: longitud CMS base64 (no es el token)=", cmsBase64.length);

  const soapBody = buildLoginCmsSoapEnvelope(cmsBase64);

  const res = await axios.post<string>(wsaaUrl, soapBody, {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '"http://ar.gov.afip.dif.facturaelectronica/loginCms"',
    },
    responseType: "text",
    transformResponse: [(body) => body],
    timeout: 60_000,
    // AFIP suele responder SOAP Fault (p. ej. coe.alreadyAuthenticated) con HTTP 500.
    validateStatus: () => true,
  });

  console.log("[wsaa] fetchWsaaLoginTicket: HTTP", res.status);

  const data = res.data;
  if (typeof data !== "string") {
    throw new Error("WSAA: empty or invalid response body");
  }

  return parseWSAAResponse(data);
}

/** @deprecated Usar fetchWsaaLoginTicket o getWsaaTicketAccess. */
export async function loginWSAA(): Promise<WsaaTicketAccess> {
  return fetchWsaaLoginTicket();
}

function taFromMemory(): WsaaTicketAccess | null {
  const now = Date.now();
  if (!taMemoryCache || now >= taMemoryCache.expiresAtMs) {
    return null;
  }
  const { expiresAtMs: _e, ...rest } = taMemoryCache;
  return rest;
}

function rememberTa(ta: WsaaTicketAccess, fetchedAtMs: number): WsaaTicketAccess {
  const expiresAtMs = computeCacheDeadlineMs(ta.expirationTime, fetchedAtMs);
  taMemoryCache = { ...ta, expiresAtMs };
  return ta;
}

/** Solo desarrollo: loguea token y sign completos (no usar así en producción). */
function logReturnedTa(source: string, ta: WsaaTicketAccess): void {
  console.log("[wsaa] TA servido desde:", source);
  console.log("[wsaa] token (completo):", ta.token);
  console.log("[wsaa] sign (completo):", ta.sign);
}

/**
 * TA: memoria → disco `./tmp/ta.json` → WSAA.
 * Si WSAA devuelve `coe.alreadyAuthenticated`, reintenta con TA en disco (si sigue válido).
 */
export async function getWsaaTicketAccess(): Promise<WsaaTicketAccess> {
  const fromMemory = taFromMemory();
  if (fromMemory) {
    logReturnedTa("caché en memoria", fromMemory);
    return fromMemory;
  }

  const fromDisk_before = loadTAFromDisk();
  if (fromDisk_before !== null && !isTAExpired(fromDisk_before.expirationTime)) {
    rememberTa(fromDisk_before, Date.now());
    logReturnedTa("tmp/ta.json (antes de WSAA)", fromDisk_before);
    return fromDisk_before;
  }

  try {
    console.log("[wsaa] Solicitando WSAA…");
    const fetchedAt = Date.now();
    const ta = await fetchWsaaLoginTicket();
    saveTAToDisk(ta);
    rememberTa(ta, fetchedAt);
    logReturnedTa("respuesta WSAA guardada en disco", ta);
    return ta;
  } catch (err) {
    if (err instanceof WsaaAlreadyAuthenticatedError) {
      const fromDisk_conflict = loadTAFromDisk();
      if (fromDisk_conflict !== null && !isTAExpired(fromDisk_conflict.expirationTime)) {
        rememberTa(fromDisk_conflict, Date.now());
        logReturnedTa("tmp/ta.json tras coe.alreadyAuthenticated", fromDisk_conflict);
        return fromDisk_conflict;
      }
    }
    throw err;
  }
}
