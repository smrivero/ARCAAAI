/**
 * AFIP WSFEv1 — homologación (DEV). Usa TA cacheado en ./tmp/ta.json (ver `wsaa.loadTAFromDisk`).
 */
import { z } from "zod";
import type { WsaaTicketAccess } from "./wsaa.js";
export declare class WsfeError extends Error {
    readonly detail?: unknown | undefined;
    readonly name = "WsfeError";
    constructor(message: string, detail?: unknown | undefined);
}
/** TA desde `./tmp/ta.json` (wrapper explícito para este módulo). */
export declare function loadTAFromDisk(): WsaaTicketAccess | null;
/**
 * Sobrecarga SOAP 1.1: método FEV1 y XML interno (hijos `<ar:*>` dentro de `<ar:methodName>`).
 */
export declare function buildSoapEnvelope(methodName: string, body: string): string;
/**
 * Envía SOAP a WSFEv1 DEV.
 */
export declare function callWSFEV1(soapEnvelope: string, soapAction: string): Promise<string>;
/** Parse genérico de respuesta WSFE (Fault HTTP ya tratado en `callWSFEV1`). */
export declare function parseWsfeSoapXml(xml: string): Record<string, unknown>;
export type FeCompUltimoAutorizadoParams = {
    ptoVta: number;
    cbteTipo: number;
};
export type FeCompUltimoAutorizadoOptions = {
    /** Si es false, no se loguea prefijo de token/sign (p. ej. listados). Por defecto true. */
    logCredentialPreview?: boolean;
    /** Si es true, no imprime línea `[wsfe] FECompUltimoAutorizado debug`. */
    quietConsole?: boolean;
};
/** Último comprobante autorizado para punto de venta y tipo de comprobante. */
export declare function feCompUltimoAutorizado(params: FeCompUltimoAutorizadoParams, options?: FeCompUltimoAutorizadoOptions): Promise<Record<string, unknown>>;
export type FeCompConsultarParams = {
    ptoVta: number;
    cbteTipo: number;
    cbteNro: number;
};
/**
 * Consulta un comprobante emitido (`FECompConsultar`).
 * No loguea token/sign (`logPreview` en Auth).
 *
 * @returns Clon liviano del `ResultGet` de AFIP, o null si no hay comprobante (hueco / número inexistente).
 */
export declare function feCompConsultar(params: FeCompConsultarParams): Promise<Record<string, unknown> | null>;
export type ListWsfeVouchersParams = {
    ptoVta: number;
    cbteTipo: number;
    limit?: number;
    fromDate?: string;
    toDate?: string;
};
export type ListWsfeVouchersResponseOk = {
    ok: true;
    ptoVta: number;
    cbteTipo: number;
    lastVoucherNumber: number;
    count: number;
    vouchers: Array<Record<string, unknown>>;
};
/**
 * Lista comprobantes hacia atrás desde el último autorizado: hasta `limit` encontrados (`FECompConsultar`)
 * sin recorrer más allá del número 1.
 * Opcionalmente filtra por fecha de emisión (`CbteFch` yyyymmdd).
 * Las credenciales no se loguean en este flujo (`FECompUltimoAutorizado` + `FECompConsultar` sin previews).
 */
export declare function listWsfeVouchers(params: ListWsfeVouchersParams): Promise<ListWsfeVouchersResponseOk>;
export declare const createVoucherBodySchema: z.ZodPipe<z.ZodObject<{
    ptoVta: z.ZodNumber;
    cbteTipo: z.ZodNumber;
    concepto: z.ZodNumber;
    docTipo: z.ZodNumber;
    docNro: z.ZodNumber;
    impTotal: z.ZodNumber;
    impNeto: z.ZodNumber;
    impIVA: z.ZodNumber;
    monId: z.ZodString;
    monCotiz: z.ZodNumber;
    iva: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        baseImp: z.ZodNumber;
        importe: z.ZodNumber;
    }, z.core.$strip>>;
    condicionIVAReceptorId: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodTransform<{
    condicionIVAReceptorId: number;
    ptoVta: number;
    cbteTipo: number;
    concepto: number;
    docTipo: number;
    docNro: number;
    impTotal: number;
    impNeto: number;
    impIVA: number;
    monId: string;
    monCotiz: number;
    iva: {
        id: number;
        baseImp: number;
        importe: number;
    }[];
}, {
    ptoVta: number;
    cbteTipo: number;
    concepto: number;
    docTipo: number;
    docNro: number;
    impTotal: number;
    impNeto: number;
    impIVA: number;
    monId: string;
    monCotiz: number;
    iva: {
        id: number;
        baseImp: number;
        importe: number;
    }[];
    condicionIVAReceptorId?: number | undefined;
}>>;
export type CreateVoucherBody = z.infer<typeof createVoucherBodySchema>;
export type FecaSolicitarResultView = {
    voucherNumber: number | null;
    cae: string | null;
    caeDueDate: string | null;
    result: string | null;
    /** AFIP desde `FECAEDetResponse` / `FECAEADetailResponse` → `Observaciones`/`Observations` → `Obs`. */
    observations: string[];
    errors: string[];
    raw: Record<string, unknown>;
};
export declare function extractCbteNroFromUltimoResponse(parsed: Record<string, unknown>): number;
export declare function distillFecaSolicitarResponse(raw: Record<string, unknown>): FecaSolicitarResultView;
/**
 * Homologación: Factura B mínima vía FECAESolicitar (después de FECompUltimoAutorizado).
 */
export declare function feCAESolicitar(input: CreateVoucherBody): Promise<FecaSolicitarResultView>;
//# sourceMappingURL=wsfev1.d.ts.map