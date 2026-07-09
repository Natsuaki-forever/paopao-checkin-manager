import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { convertHar, previewHar } from "../har/importer.js";
import { requireCapability } from "../services/access.js";

const harBody = z.object({ har: z.unknown() });
export function registerHarRoutes(app: FastifyInstance): void {
  app.post("/api/har/preview", { bodyLimit: 5 * 1024 * 1024 }, async (request) => {
    requireCapability(app.getAuthPrincipal(request)!, "importHar");
    const { har } = harBody.parse(request.body);
    return { items: previewHar(har) };
  });
  app.post("/api/har/convert", { bodyLimit: 5 * 1024 * 1024 }, async (request) => {
    requireCapability(app.getAuthPrincipal(request)!, "importHar");
    const { har, selected } = z.object({
      har: z.unknown(), selected: z.array(z.number().int().nonnegative()).min(1).max(100),
    }).parse(request.body);
    return convertHar(har, selected);
  });
}
