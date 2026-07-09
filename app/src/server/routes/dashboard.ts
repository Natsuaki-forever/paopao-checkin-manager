import type { FastifyInstance } from "fastify";
import type {
  DashboardAttentionItem,
  DashboardResponse,
  RunStatus,
  TaskSummary,
} from "../../shared/types.js";
import type { AppDatabase } from "../database.js";
import type { TaskSessionRepository } from "../repositories/task-session.js";
import type { RunQueue } from "../services/run-queue.js";
import { principalOwnerId } from "../services/access.js";
import { zonedMinute } from "../services/next-run.js";

const attentionStatuses = new Set<RunStatus>([
  "challenge",
  "auth_required",
  "session_expired",
  "page_changed",
  "proxy_failure",
  "failure",
]);

function attentionFor(task: TaskSummary): DashboardAttentionItem | undefined {
  const run = task.latestRun;
  if (!run || !attentionStatuses.has(run.status)) return undefined;
  const kind = run.status as DashboardAttentionItem["kind"];
  const action: DashboardAttentionItem["action"] =
    kind === "challenge" || kind === "auth_required" || kind === "session_expired"
      ? "manual_login"
      : kind === "proxy_failure"
        ? "check_proxy"
        : kind === "page_changed"
          ? "edit_task"
          : "view_run";
  return {
    taskId: task.id,
    taskName: task.name,
    kind,
    severity: kind === "challenge" || kind === "auth_required" || kind === "session_expired"
      ? "high" : "medium",
    message: run.message,
    runId: run.id,
    action,
  };
}

function completedToday(task: TaskSummary, now: Date): boolean {
  const run = task.latestRun;
  if (!run || !["success", "already_checked"].includes(run.status)) return false;
  return zonedMinute(new Date(run.finishedAt), task.timezone).date === zonedMinute(now, task.timezone).date;
}

export function registerDashboardRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  queue?: RunQueue,
  sessions?: TaskSessionRepository,
): void {
  app.get("/api/dashboard", async (request): Promise<DashboardResponse> => {
    const principal = app.getAuthPrincipal(request)!;
    const ownerUserId = principalOwnerId(principal);
    const now = new Date();
    const tasks = database.listTasksByOwner(ownerUserId).map((task) => ({
      ...task,
      activeJob: queue?.jobs.getActiveForTask(task.id),
      sessionStatus: sessions?.getStatus(task.id),
    }));
    const attention = tasks.flatMap((task) => {
      const item = attentionFor(task);
      return item ? [item] : [];
    });
    const nextRunAt = tasks
      .flatMap((task) => task.enabled && task.nextRunAt ? [task.nextRunAt] : [])
      .sort()[0];
    const response: DashboardResponse = {
      generatedAt: now.toISOString(),
      summary: {
        todayPlanned: tasks.filter((task) => task.enabled).length,
        todayCompleted: tasks.filter((task) => completedToday(task, now)).length,
        attentionCount: attention.length,
        nextRunAt,
        validSessionCount: tasks.filter((task) => task.sessionStatus?.status === "valid").length,
      },
      attention,
      tasks: [...tasks].sort((left, right) =>
        (left.nextRunAt || "9999").localeCompare(right.nextRunAt || "9999")),
    };
    if (principal.role === "admin") {
      const activeUsers = database.db.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE status = 'active'",
      ).get() as { count: number };
      const pending = database.db.prepare(
        "SELECT COUNT(*) AS count FROM template_submissions WHERE status = 'pending'",
      ).get() as { count: number };
      const failures = database.db.prepare(`SELECT COUNT(*) AS count FROM runs
        WHERE status NOT IN ('success', 'already_checked', 'cancelled') AND finished_at >= ?`)
        .get(new Date(now.getTime() - 86_400_000).toISOString()) as { count: number };
      response.admin = {
        activeUsers: activeUsers.count,
        pendingTemplateSubmissions: pending.count,
        failures24h: failures.count,
      };
    }
    return response;
  });
}
