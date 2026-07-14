import { randomUUID } from "node:crypto";
import type { AuthPrincipal } from "../fastify.js";
import type { AppDatabase } from "../database.js";
import type { UserCapabilities } from "../../shared/types.js";

export const allCapabilities: UserCapabilities = {
  scheduleTasks: true,
  runTasksManually: true,
  useManualLogin: true,
  importHar: true,
  useHttpFlow: true,
  useCustomProxy: true,
  submitSharedTemplates: true,
};

export function forbidden(message = "没有执行该操作的权限"): Error {
  return Object.assign(new Error(message), { statusCode: 403 });
}

export function notFound(message = "资源不存在"): Error {
  return Object.assign(new Error(message), { statusCode: 404 });
}

export function tooMany(message = "今日操作次数已达上限"): Error {
  return Object.assign(new Error(message), { statusCode: 429 });
}

export function principalOwnerId(principal: AuthPrincipal): string | null {
  return principal.owner ? null : principal.userId || null;
}

export function ownsResource(principal: AuthPrincipal, ownerUserId: string | null): boolean {
  return principal.owner ? ownerUserId === null : principal.userId === ownerUserId;
}

export function requireAdmin(principal: AuthPrincipal): void {
  if (principal.role !== "admin") throw forbidden("仅管理员可以执行该操作");
}

export function requireOwner(principal: AuthPrincipal): void {
  if (!principal.owner) throw forbidden("仅主管理员可以执行该操作");
}

export function requireCapability(
  principal: AuthPrincipal,
  capability: keyof UserCapabilities,
): void {
  if (principal.role === "admin") return;
  if (!principal.capabilities[capability]) throw forbidden("该功能尚未获得管理员授权");
}

export function enforceTaskQuota(
  database: Pick<AppDatabase, "db">,
  principal: AuthPrincipal,
  enabled: boolean,
  excludingTaskId?: string,
): void {
  if (principal.role === "admin" || !principal.userId) return;
  const exclude = excludingTaskId ? " AND id != ?" : "";
  const parameters = excludingTaskId
    ? [principal.userId, excludingTaskId]
    : [principal.userId];
  const total = database.db.prepare(
    `SELECT COUNT(*) AS count FROM tasks WHERE owner_user_id = ?${exclude}`,
  ).get(...parameters) as { count: number };
  if (!excludingTaskId && total.count >= principal.quotas.maxTasks) {
    throw forbidden(`最多可以创建 ${principal.quotas.maxTasks} 个任务`);
  }
  if (enabled) {
    const active = database.db.prepare(
      `SELECT COUNT(*) AS count FROM tasks WHERE owner_user_id = ? AND enabled = 1${exclude}`,
    ).get(...parameters) as { count: number };
    if (active.count >= principal.quotas.maxEnabledTasks) {
      throw forbidden(`最多可以启用 ${principal.quotas.maxEnabledTasks} 个计划`);
    }
  }
}

function shanghaiDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function consumeDailyAction(database: Pick<AppDatabase, "db">, principal: AuthPrincipal): void {
  if (principal.role === "admin" || !principal.userId) return;
  const usageDate = shanghaiDate();
  const result = database.db.transaction(() => {
    database.db.prepare(`INSERT INTO usage_counters(user_id, usage_date, action_count)
      VALUES(?, ?, 0) ON CONFLICT(user_id, usage_date) DO NOTHING`)
      .run(principal.userId, usageDate);
    return database.db.prepare(`UPDATE usage_counters SET action_count = action_count + 1
      WHERE user_id = ? AND usage_date = ? AND action_count < ?`)
      .run(principal.userId, usageDate, principal.quotas.maxDailyActions);
  })();
  if (result.changes === 0) throw tooMany();
}

export function writeAudit(
  database: Pick<AppDatabase, "db">,
  principal: AuthPrincipal,
  action: string,
  targetType: string,
  options: {
    targetId?: string;
    targetLabel?: string;
    result?: "success" | "denied" | "failure";
    metadata?: Record<string, unknown>;
  } = {},
): void {
  database.db.prepare(`INSERT INTO audit_events(
    id, actor_user_id, actor_role, actor_owner, actor_display_name,
    action, target_type, target_id, target_label, result, metadata_json, created_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    randomUUID(),
    principal.userId || null,
    principal.role,
    Number(principal.owner),
    principal.displayName,
    action,
    targetType,
    options.targetId || null,
    options.targetLabel || null,
    options.result || "success",
    JSON.stringify(options.metadata || {}),
    new Date().toISOString(),
  );
}

export function writeAuthenticationFailure(
  database: Pick<AppDatabase, "db">,
  mechanism: "admin_password" | "user_password",
): void {
  database.db.prepare(`INSERT INTO audit_events(
    id, actor_user_id, actor_role, actor_owner, actor_display_name,
    action, target_type, target_id, target_label, result, metadata_json, created_at
  ) VALUES(?, NULL, 'user', 0, 'anonymous', 'auth.login', 'authentication', NULL, NULL, 'denied', ?, ?)`)
    .run(randomUUID(), JSON.stringify({ mechanism }), new Date().toISOString());
}
