/**
 * Gestor de TA (ticket de acceso WSAA) para WSFE: lectura de `tmp/ta.json`,
 * ventana de renovación (≤5 min al vencimiento) y persistencia asíncrona.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  fetchWsaaLoginTicket,
  isTAExpired,
  parseAfipTaExpirationToMs,
  WsaaAlreadyAuthenticatedError,
  type WsaaTicketAccess,
} from "../../arca/wsaa.js";

const TA_JSON_PATH = path.join(process.cwd(), "tmp", "ta.json");

/** Renovar si el TA queda con menos de este tiempo hasta `expirationTime` (AFIP). */
const TA_MIN_REMAINING_MS = 5 * 60 * 1000;

let refreshInFlight: Promise<{ token: string; sign: string }> | null = null;

function hasMinRemainingBeforeExpiration(expirationTime: string): boolean {
  const expMs = parseAfipTaExpirationToMs(expirationTime);
  if (expMs === null) {
    return false;
  }
  return expMs - Date.now() >= TA_MIN_REMAINING_MS;
}

function parseTaRecord(data: unknown): WsaaTicketAccess | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const rec = data as Record<string, unknown>;
  const token = typeof rec["token"] === "string" ? rec["token"] : "";
  const sign = typeof rec["sign"] === "string" ? rec["sign"] : "";
  const generationTime = typeof rec["generationTime"] === "string" ? rec["generationTime"] : "";
  const expirationTime = typeof rec["expirationTime"] === "string" ? rec["expirationTime"] : "";
  if (token === "" || sign === "" || expirationTime === "") {
    return null;
  }
  return { token, sign, generationTime, expirationTime };
}

async function readTAFromDisk(): Promise<WsaaTicketAccess | null> {
  try {
    const raw = await readFile(TA_JSON_PATH, "utf8");
    const data: unknown = JSON.parse(raw);
    return parseTaRecord(data);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return null;
    }
    if (err instanceof SyntaxError) {
      return null;
    }
    throw err;
  }
}

async function saveNewTA(ta: WsaaTicketAccess): Promise<void> {
  const dir = path.dirname(TA_JSON_PATH);
  await mkdir(dir, { recursive: true });
  const payload = `${JSON.stringify(ta, null, 2)}\n`;
  await writeFile(TA_JSON_PATH, payload, "utf8");
}

async function refreshTAFromWsaa(): Promise<{ token: string; sign: string }> {
  console.log("[TA] expired, requesting new TA");
  try {
    const ta = await fetchWsaaLoginTicket();
    await saveNewTA(ta);
    console.log("[TA] saved new TA");
    return { token: ta.token, sign: ta.sign };
  } catch (err) {
    if (err instanceof WsaaAlreadyAuthenticatedError) {
      const fromDisk = await readTAFromDisk();
      if (fromDisk !== null && !isTAExpired(fromDisk.expirationTime)) {
        console.log("[TA] using cached TA");
        return { token: fromDisk.token, sign: fromDisk.sign };
      }
    }
    throw err;
  }
}

/**
 * Devuelve `token` y `sign` válidos para WSFE: usa `tmp/ta.json` si aún hay ≥ 5 min
 * hasta el vencimiento AFIP; si no, pide TA a WSAA y guarda el archivo.
 */
export async function getValidTA(): Promise<{ token: string; sign: string }> {
  const fromDisk = await readTAFromDisk();
  if (fromDisk !== null && hasMinRemainingBeforeExpiration(fromDisk.expirationTime)) {
    console.log("[TA] using cached TA");
    return { token: fromDisk.token, sign: fromDisk.sign };
  }

  if (!refreshInFlight) {
    refreshInFlight = refreshTAFromWsaa().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}
