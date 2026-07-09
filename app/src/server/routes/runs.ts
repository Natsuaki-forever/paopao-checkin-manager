import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RunListResponse, RunRecord } from "../../shared/types.js";
import type { AppDatabase } from "../database.js";
import { runFromRow } from "../database.js";
import { notFound, principalOwnerId } from "../services/access.js";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  taskId: z.string().uuid().optional(),
  status: z
    .enum([
      "success",
      "already_checked",
      "auth_required",
      "challenge",
      "page_changed",
      "session_expired",
      "proxy_failure",
      "cancelled",
      "failure",
    ])
    .optional(),
  trigger: z.enum(["manual", "scheduled"]).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export function registerRunRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  screenshotDir: string,
): void {
  app.get("/api/runs", async (request) => {
    const query = querySchema.parse(request.query);
    const ownerUserId = principalOwnerId(app.getAuthPrincipal(request)!);
    const clauses: string[] = [ownerUserId ? "owner_user_id = ?" : "owner_user_id IS NULL"];
    const parameters: unknown[] = [];
    if (ownerUserId) parameters.push(ownerUserId);
    if (query.taskId) {
      clauses.push("task_id = ?");
      parameters.push(query.taskId);
    }
    if (query.status) {
      clauses.push("status = ?");
      parameters.push(query.status);
    }
    if (query.trigger) {
      clauses.push("trigger = ?");
      parameters.push(query.trigger);
    }
    if (query.from) {
      clauses.push("finished_at >= ?");
      parameters.push(query.from);
    }
    if (query.to) {
      clauses.push("finished_at <= ?");
      parameters.push(query.to);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = database.db
      .prepare(`SELECT COUNT(*) AS count FROM runs ${where}`)
      .get(...parameters) as { count: number };
    const rows = database.db
      .prepare(
        `SELECT * FROM runs ${where} ORDER BY finished_at DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...parameters,
        query.pageSize,
        (query.page - 1) * query.pageSize,
      ) as Parameters<typeof runFromRow>[0][];
    return {
      items: rows.map(runFromRow),
      page: query.page,
      pageSize: query.pageSize,
      total: total.count,
    } satisfies RunListResponse;
  });

  app.get("/api/runs/:id", async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const run: RunRecord | undefined = database.getRun(id);
    const ownerUserId = principalOwnerId(app.getAuthPrincipal(request)!);
    if (!run || (run.ownerUserId || null) !== ownerUserId) throw notFound("运行记录不存在");
    return run;
  });

  app.get("/api/runs/:id/screenshot", async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const run = database.getRun(id);
    const ownerUserId = principalOwnerId(app.getAuthPrincipal(request)!);
    if (!run || (run.ownerUserId || null) !== ownerUserId) throw notFound("运行记录不存在");
    const screenshotPath = database.getScreenshotPath(id);
    if (!screenshotPath) {
      return reply.code(404).send({ message: "该记录没有失败截图" });
    }
    const root = path.resolve(screenshotDir) + path.sep;
    const resolved = path.resolve(screenshotPath);
    if (!resolved.startsWith(root)) {
      return reply.code(403).send({ message: "截图路径无效" });
    }
    const file = await stat(resolved).catch(() => undefined);
    if (!file?.isFile()) return reply.code(404).send({ message: "截图文件不存在" });
    return reply.type("image/png").send(createReadStream(resolved));
  });
}
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
