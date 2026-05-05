export async function healthRoutes(app) {
    app.get("/health", async () => {
        return {
            ok: true,
            service: "arca-agent",
            timestamp: new Date().toISOString(),
        };
    });
}
//# sourceMappingURL=health.routes.js.map