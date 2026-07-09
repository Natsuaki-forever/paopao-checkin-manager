import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import type { BrowserStorageState, TaskSessionRepository } from "../repositories/task-session.js";
import {
  consumeDailyAction,
  notFound,
  principalOwnerId,
  requireCapability,
  writeAudit,
} from "../services/access.js";

const idSchema = z.object({ id: z.uuid() });
const tokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const cookieBodySchema = z.object({ cookie: z.string().trim().min(1).max(16_384) });

export function registerSessionRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  sessions: TaskSessionRepository,
): void {
  app.get("/api/tasks/:id/session", async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    if (!database.getTaskForOwner(id, principalOwnerId(app.getAuthPrincipal(request)!))) throw notFound("签到任务不存在");
    return sessions.getStatus(id);
  });

  app.delete("/api/tasks/:id/session", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    const { id } = idSchema.parse(request.params);
    const task = database.getTaskForOwner(id, principalOwnerId(principal));
    if (!task) throw notFound("签到任务不存在");
    sessions.clear(id);
    writeAudit(database, principal, "session.clear", "task", { targetId: id, targetLabel: task.name });
    return reply.code(204).send();
  });

  app.post("/api/tasks/:id/session/cookies", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    requireCapability(principal, "useManualLogin");
    const { id } = idSchema.parse(request.params);
    const task = database.getTaskForOwner(id, principalOwnerId(principal));
    if (!task) throw notFound("签到任务不存在");
    const { cookie } = cookieBodySchema.parse(request.body);
    consumeDailyAction(database, principal);
    writeAudit(database, principal, "session.cookie.import", "task", { targetId: id, targetLabel: task.name });
    return sessions.save(id, parseCookieState(cookie, task.checkinUrl));
  });

  app.post("/api/tasks/:id/session/manual-token", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    requireCapability(principal, "useManualLogin");
    const { id } = idSchema.parse(request.params);
    if (!database.getTaskForOwner(id, principalOwnerId(principal))) throw notFound("签到任务不存在");
    consumeDailyAction(database, principal);
    const issued = sessions.issueManualToken(id);
    return reply.code(201).send({
      expiresAt: issued.expiresAt,
      submitPath: `/api/session/manual/${issued.token}`,
    });
  });

  app.post("/api/session/manual/:token", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const { token } = tokenSchema.parse(request.params);
    const { cookie } = cookieBodySchema.parse(request.body);
    const taskId = sessions.consumeManualToken(token);
    if (!taskId) return reply.code(410).send({ message: "一次性登录令牌无效、已使用或已过期" });
    const task = database.getTask(taskId);
    if (!task) return reply.code(410).send({ message: "一次性登录令牌对应的任务已不存在" });
    sessions.save(taskId, parseCookieState(cookie, task.checkinUrl));
    return { status: "saved" };
  });
}

function parseCookieState(cookie: string, checkinUrl: string): BrowserStorageState {
  const target = new URL(checkinUrl);
  const cookies = cookie.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) throw new Error("Cookie 字符串格式无效");
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/.test(name) ||
      /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error("Cookie 字符串包含无效字符");
    }
    return {
      name,
      value,
      domain: target.hostname,
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: target.protocol === "https:",
      sameSite: "Lax" as const,
    };
  });
  if (cookies.length > 100) throw new Error("Cookie 数量过多");
  return { cookies, origins: [] };
}
