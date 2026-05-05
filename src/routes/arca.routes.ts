import type { FastifyInstance } from "fastify";
import {
  getWsaaTicketAccess,
  WsaaAlreadyAuthenticatedError,
} from "../arca/wsaa.js";

const TA_CONFLICT_MESSAGE =
  "AFIP indicates a TA is already valid for this credential, but this backend has no usable copy (no valid ./tmp/ta.json). Wait until AFIP TTL expires or place a TA JSON file there after a successful login elsewhere.";

export async function arcaRoutes(app: FastifyInstance) {
  app.get("/ping", async () => {
    return {
      ok: true,
      service: "arca",
      mode: "homo",
    };
  });

  /** Homologación: TA desde caché en memoria o WSAA. Solo para pruebas. */
  app.get("/wsaa/login", async (request, reply) => {
    try {
      const { token, sign, generationTime, expirationTime } = await getWsaaTicketAccess();
      return { ok: true, token, sign, generationTime, expirationTime };
    } catch (err) {
      if (err instanceof WsaaAlreadyAuthenticatedError) {
        request.log.warn({ err: err.name }, "WSAA alreadyAuthenticated (no token logged)");
        return await reply.status(409).send({
          ok: false,
          error: TA_CONFLICT_MESSAGE,
        });
      }
      request.log.error(
        err instanceof Error
          ? { errName: err.name, errMessage: err.message }
          : { err: String(err) },
        "GET /arca/wsaa/login failed",
      );
      const message = err instanceof Error ? err.message : String(err);
      return await reply.status(500).send({ ok: false, error: message });
    }
  });
}
