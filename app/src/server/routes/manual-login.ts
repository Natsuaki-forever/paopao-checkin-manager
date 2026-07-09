import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ManualLoginService } from "../services/manual-login.js";
import type { AppDatabase } from "../database.js";
import {
  consumeDailyAction,
  notFound,
  principalOwnerId,
  requireCapability,
  writeAudit,
} from "../services/access.js";

const taskParams = z.object({ id: z.uuid() });
const sessionParams = z.object({ sessionId: z.uuid() });
const clickBody = z.object({
  x: z.number().int().min(0).max(1279),
  y: z.number().int().min(0).max(799),
});
const typeBody = z.object({ text: z.string().min(1).max(2000) });
const keyBody = z.object({
  key: z.enum(["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]),
});

export function registerManualLoginRoutes(
  app: FastifyInstance,
  service: ManualLoginService,
  database: AppDatabase,
): void {
  app.post("/api/tasks/:id/manual-login/start", {
    config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
  }, async (request) => {
    const principal = app.getAuthPrincipal(request)!;
    requireCapability(principal, "useManualLogin");
    const taskId = taskParams.parse(request.params).id;
    const task = database.getTaskForOwner(taskId, principalOwnerId(principal));
    if (!task) throw notFound("签到任务不存在");
    consumeDailyAction(database, principal);
    writeAudit(database, principal, "manual_login.start", "task", { targetId: taskId, targetLabel: task.name });
    return service.start(taskId);
  });

  const requireSession = (request: FastifyRequest, sessionId: string) => {
    const principal = app.getAuthPrincipal(request)!;
    const task = database.getTaskForOwner(service.taskId(sessionId), principalOwnerId(principal));
    if (!task) throw notFound("人工登录会话不存在或已结束");
    return { principal, task };
  };

  app.get("/api/manual-login/:sessionId", async (request) => {
    const sessionId = sessionParams.parse(request.params).sessionId;
    requireSession(request, sessionId);
    return service.state(sessionId);
  });

  app.get("/api/manual-login/:sessionId/screenshot", async (request, reply) => {
    const sessionId = sessionParams.parse(request.params).sessionId;
    requireSession(request, sessionId);
    const image = await service.screenshot(sessionId);
    return reply.header("cache-control", "no-store").type("image/png").send(image);
  });

  app.post("/api/manual-login/:sessionId/click", async (request) => {
    const { sessionId } = sessionParams.parse(request.params);
    requireSession(request, sessionId);
    const { x, y } = clickBody.parse(request.body);
    return service.click(sessionId, x, y);
  });

  app.post("/api/manual-login/:sessionId/element/inspect", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request) => {
    const { sessionId } = sessionParams.parse(request.params);
    requireSession(request, sessionId);
    const { x, y } = clickBody.parse(request.body);
    return service.inspectElement(sessionId, x, y);
  });

  app.post("/api/manual-login/:sessionId/element/confirm", async (request) => {
    const sessionId = sessionParams.parse(request.params).sessionId;
    requireSession(request, sessionId);
    return service.confirmElement(sessionId);
  });

  app.post("/api/manual-login/:sessionId/type", {
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  }, async (request) => {
    const { sessionId } = sessionParams.parse(request.params);
    requireSession(request, sessionId);
    return service.type(sessionId, typeBody.parse(request.body).text);
  });

  app.post("/api/manual-login/:sessionId/key", async (request) => {
    const { sessionId } = sessionParams.parse(request.params);
    requireSession(request, sessionId);
    return service.key(sessionId, keyBody.parse(request.body).key);
  });

  app.post("/api/manual-login/:sessionId/checkin", async (request) => {
    const sessionId = sessionParams.parse(request.params).sessionId;
    requireSession(request, sessionId);
    return service.goToCheckin(sessionId);
  });

  app.post("/api/manual-login/:sessionId/save", async (request, reply) => {
    const sessionId = sessionParams.parse(request.params).sessionId;
    const { principal, task } = requireSession(request, sessionId);
    await service.save(sessionId);
    writeAudit(database, principal, "manual_login.save", "task", { targetId: task.id, targetLabel: task.name });
    return reply.code(204).send();
  });

  app.post("/api/manual-login/:sessionId/cancel", async (request, reply) => {
    const sessionId = sessionParams.parse(request.params).sessionId;
    requireSession(request, sessionId);
    await service.close(sessionId);
    return reply.code(204).send();
  });
}
