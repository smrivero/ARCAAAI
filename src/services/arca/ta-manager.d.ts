/**
 * Gestor de TA (ticket de acceso WSAA) para WSFE: lectura de `tmp/ta.json`,
 * ventana de renovación (≤5 min al vencimiento) y persistencia asíncrona.
 */
/**
 * Devuelve `token` y `sign` válidos para WSFE: usa `tmp/ta.json` si aún hay ≥ 5 min
 * hasta el vencimiento AFIP; si no, pide TA a WSAA y guarda el archivo.
 */
export declare function getValidTA(): Promise<{
    token: string;
    sign: string;
}>;
//# sourceMappingURL=ta-manager.d.ts.map