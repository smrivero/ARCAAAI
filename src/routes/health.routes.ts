import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      ok: true,
      service: "arca-agent",
      timestamp: new Date().toISOString(),
    };
  });
}
