import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RunQueue } from "../services/run-queue.js";
import type { AppDatabase } from "../database.js";
import { notFound, principalOwnerId, writeAudit } from "../services/access.js";

const idSchema = z.object({ id: z.uuid() });

export function registerJobRoutes(app: FastifyInstance, queue: RunQueue, database: AppDatabase): void {
  app.get("/api/jobs/:id", async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const job = queue.jobs.get(id);
    if (!job || !database.getTaskForOwner(job.taskId, principalOwnerId(app.getAuthPrincipal(request)!))) {
      throw notFound("运行任务不存在");
    }
    return job;
  });

  app.post("/api/jobs/:id/cancel", async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const job = queue.jobs.get(id);
    const principal = app.getAuthPrincipal(request)!;
    const task = job && database.getTaskForOwner(job.taskId, principalOwnerId(principal));
    if (!job || !task) throw notFound("运行任务不存在");
    try {
      const cancelled = queue.jobs.cancel(id);
      writeAudit(database, principal, "job.cancel", "job", { targetId: id, targetLabel: task.name });
      return cancelled;
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "运行任务无法取消",
      });
    }
  });
}
