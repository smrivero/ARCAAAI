export async function arcaRoutes(app) {
    app.get("/ping", async () => {
        return {
            ok: true,
            service: "arca",
            mode: "homo",
        };
    });
}
//# sourceMappingURL=arca.routes.js.map