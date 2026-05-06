/**
 * AFIP WSAA LoginCms (homologación / desarrollo).
 * Firma PKCS#7 del TRA vía ejecutable `openssl` del sistema (subcomando `cms`).
 */
export declare class WsaaAlreadyAuthenticatedError extends Error {
    readonly name = "WsaaAlreadyAuthenticatedError";
    constructor();
}
/** TA persistido / devuelto por WSAA (loginTicketResponse). */
export type WsaaTicketAccess = {
    token: string;
    sign: string;
    generationTime: string;
    expirationTime: string;
};
/** Fecha/hora en formato ISO 8601 con offset fijo -03:00 (Argentina). */
export declare function formatAfipDateTime(d: Date): string;
/**
 * Genera el XML del Ticket de Requerimiento de Acceso (TRA).
 *
 * @param service - Servicio AFIP (ej. wsfe). Por defecto desde env o `wsfe`.
 */
export declare function createLoginTicketRequest(service?: string): string;
/**
 * Firma el contenido XML con CMS (PKCS#7) en formato DER usando OpenSSL CLI.
 * Requiere `openssl` instalado y accesible en PATH.
 */
export declare function signCMS(xmlContent: string, certPath: string, keyPath: string): Buffer;
/** Carga `./tmp/ta.json`. Devuelve null si falta archivo, JSON inválido o formato incorrecto. */
export declare function loadTAFromDisk(): WsaaTicketAccess | null;
/** Guarda TA en `./tmp/ta.json` (solo dev). Sync. */
export declare function saveTAToDisk(ta: WsaaTicketAccess): void;
/** Convierte el valor de expirationTime del TA a milliseconds (UTC). Devuelve null si no parsea. */
export declare function parseAfipTaExpirationToMs(expirationTime: string): number | null;
/** Verdadero si el TA ya no debe usarse (incluye margen de seguridad ante expirationTime). */
export declare function isTAExpired(expirationTime: string): boolean;
/**
 * Parsea la respuesta SOAP de loginCms y extrae token, sign, generationTime y expirationTime del TA.
 */
export declare function parseWSAAResponse(soapXml: string): WsaaTicketAccess;
/**
 * Llama siempre a WSAA (sin caché). Útil para pruebas o forzar renovación.
 */
export declare function fetchWsaaLoginTicket(): Promise<WsaaTicketAccess>;
/** @deprecated Usar fetchWsaaLoginTicket o getWsaaTicketAccess. */
export declare function loginWSAA(): Promise<WsaaTicketAccess>;
/**
 * TA: memoria → disco `./tmp/ta.json` → WSAA.
 * Si WSAA devuelve `coe.alreadyAuthenticated`, reintenta con TA en disco (si sigue válido).
 */
export declare function getWsaaTicketAccess(): Promise<WsaaTicketAccess>;
//# sourceMappingURL=wsaa.d.ts.map