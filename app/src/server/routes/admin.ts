import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  defaultUserCapabilities,
  defaultUserQuotas,
  type AdminUserSummary,
  type AuditEvent,
  type BrowserFormTemplateConfig,
  type TemplateSubmission,
  type UserCapabilities,
} from "../../shared/types.js";
import { normalizeBrowserFormTemplateConfig } from "../../shared/browser-form.js";
import type { AppDatabase } from "../database.js";
import { hashToken } from "../crypto.js";
import type { TaskSessionRepository } from "../repositories/task-session.js";
import type { RunQueue } from "../services/run-queue.js";
import type { ManualLoginService } from "../services/manual-login.js";
import {
  allCapabilities,
  forbidden,
  notFound,
  requireAdmin,
  requireOwner,
  writeAudit,
} from "../services/access.js";

const userIdSchema = z.object({ id: z.uuid() });
const capabilitySchema = z.object({
  scheduleTasks: z.boolean(),
  runTasksManually: z.boolean(),
  useManualLogin: z.boolean(),
  importHar: z.boolean(),
  useHttpFlow: z.boolean(),
  useCustomProxy: z.boolean(),
  submitSharedTemplates: z.boolean(),
});
const quotaSchema = z.object({
  maxTasks: z.number().int().min(0).max(1_000),
  maxEnabledTasks: z.number().int().min(0).max(1_000),
  maxDailyActions: z.number().int().min(0).max(10_000),
}).refine((value) => value.maxEnabledTasks <= value.maxTasks, {
  message: "启用计划上限不能超过任务上限",
});

interface UserRow {
  id: string;
  username: string;
  role: "user" | "admin";
  status: "active" | "suspended";
  capabilities_json: string;
  max_tasks: number;
  max_enabled_tasks: number;
  max_daily_actions: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseCapabilities(value: string): UserCapabilities {
  try {
    return capabilitySchema.parse({ ...defaultUserCapabilities, ...JSON.parse(value) });
  } catch {
    return defaultUserCapabilities;
  }
}

function userSummary(database: AppDatabase, row: UserRow): AdminUserSummary {
  const counts = database.db.prepare(`SELECT
    COUNT(*) AS task_count,
    SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled_count
    FROM tasks WHERE owner_user_id = ?`).get(row.id) as {
    task_count: number;
    enabled_count: number | null;
  };
  const templates = database.db.prepare(
    "SELECT COUNT(*) AS count FROM templates WHERE owner_user_id = ?",
  ).get(row.id) as { count: number };
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    capabilities: row.role === "admin" ? allCapabilities : parseCapabilities(row.capabilities_json),
    quotas: row.role === "admin" ? {
      maxTasks: 1_000_000,
      maxEnabledTasks: 1_000_000,
      maxDailyActions: 1_000_000,
    } : {
      maxTasks: row.max_tasks,
      maxEnabledTasks: row.max_enabled_tasks,
      maxDailyActions: row.max_daily_actions,
    },
    taskCount: counts.task_count,
    enabledTaskCount: counts.enabled_count || 0,
    templateCount: templates.count,
    lastLoginAt: row.last_login_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerAdminRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  options: {
    registrationEnvironmentEnabled: boolean;
    queue?: RunQueue;
    sessions?: TaskSessionRepository;
    manualLogin?: ManualLoginService;
    screenshotDir?: string;
  },
): void {
  const principal = (request: FastifyRequest) => {
    const value = app.getAuthPrincipal(request)!;
    requireAdmin(value);
    return value;
  };
  const getUser = (id: string): UserRow => {
    const row = database.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    if (!row) throw notFound("用户不存在");
    return row;
  };
  const requireManageable = (actor: ReturnType<typeof principal>, user: UserRow): void => {
    if (user.role === "admin" && !actor.owner) throw forbidden("运营管理员不能管理其他管理员");
  };

  app.get("/api/admin/users", async (request) => {
    principal(request);
    const rows = database.db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as UserRow[];
    return { items: rows.map((row) => userSummary(database, row)) };
  });

  app.get("/api/admin/users/:id", async (request) => {
    principal(request);
    return userSummary(database, getUser(userIdSchema.parse(request.params).id));
  });

  app.patch("/api/admin/users/:id", async (request) => {
    const actor = principal(request);
    const { id } = userIdSchema.parse(request.params);
    const user = getUser(id);
    requireManageable(actor, user);
    const body = z.object({
      status: z.enum(["active", "suspended"]).optional(),
      capabilities: capabilitySchema.optional(),
      quotas: quotaSchema.optional(),
    }).parse(request.body);
    if (user.role === "admin" && (body.capabilities || body.quotas)) {
      throw forbidden("管理员账号不使用普通用户权限配额");
    }
    const nextStatus = body.status || user.status;
    database.db.transaction(() => {
      database.db.prepare(`UPDATE users SET status = ?, capabilities_json = ?,
        max_tasks = ?, max_enabled_tasks = ?, max_daily_actions = ?,
        suspended_at = ?, updated_at = ? WHERE id = ?`).run(
        nextStatus,
        JSON.stringify(body.capabilities || parseCapabilities(user.capabilities_json)),
        body.quotas?.maxTasks ?? user.max_tasks,
        body.quotas?.maxEnabledTasks ?? user.max_enabled_tasks,
        body.quotas?.maxDailyActions ?? user.max_daily_actions,
        nextStatus === "suspended" ? new Date().toISOString() : null,
        new Date().toISOString(),
        id,
      );
      if (nextStatus === "suspended") {
        database.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
        database.db.prepare("UPDATE tasks SET enabled = 0, updated_at = ? WHERE owner_user_id = ?")
          .run(new Date().toISOString(), id);
        database.db.prepare(`UPDATE run_jobs SET status = 'cancelled', finished_at = ?
          WHERE task_id IN (SELECT id FROM tasks WHERE owner_user_id = ?) AND status = 'queued'`)
          .run(new Date().toISOString(), id);
        database.db.prepare(`UPDATE run_jobs SET cancel_requested = 1
          WHERE task_id IN (SELECT id FROM tasks WHERE owner_user_id = ?) AND status = 'running'`)
          .run(id);
      }
    })();
    if (nextStatus === "suspended") {
      const taskIds = new Set((database.db.prepare("SELECT id FROM tasks WHERE owner_user_id = ?")
        .all(id) as Array<{ id: string }>).map((item) => item.id));
      options.queue?.requestCancelTasks(taskIds);
      await options.manualLogin?.closeForTaskIds(taskIds);
    }
    writeAudit(database, actor, nextStatus === "suspended" ? "user.suspend" : "user.update", "user", {
      targetId: id,
      targetLabel: user.username,
      metadata: { status: nextStatus },
    });
    return userSummary(database, getUser(id));
  });

  app.put("/api/admin/users/:id/role", async (request) => {
    const actor = principal(request);
    requireOwner(actor);
    const { id } = userIdSchema.parse(request.params);
    const user = getUser(id);
    const { role } = z.object({ role: z.enum(["user", "admin"]) }).parse(request.body);
    database.db.transaction(() => {
      database.db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
        .run(role, new Date().toISOString(), id);
      database.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    })();
    writeAudit(database, actor, role === "admin" ? "user.promote" : "user.demote", "user", {
      targetId: id,
      targetLabel: user.username,
    });
    return userSummary(database, getUser(id));
  });

  app.post("/api/admin/users/:id/revoke-sessions", async (request) => {
    const actor = principal(request);
    const { id } = userIdSchema.parse(request.params);
    const user = getUser(id);
    requireManageable(actor, user);
    const revoked = database.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id).changes;
    writeAudit(database, actor, "user.sessions.revoke", "user", {
      targetId: id,
      targetLabel: user.username,
      metadata: { revoked },
    });
    return { success: true, revoked };
  });

  app.post("/api/admin/users/:id/password-reset", async (request) => {
    const actor = principal(request);
    const { id } = userIdSchema.parse(request.params);
    const user = getUser(id);
    requireManageable(actor, user);
    const token = randomBytes(32).toString("base64url");
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    database.db.transaction(() => {
      database.db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ?")
        .run(id, createdAt);
      database.db.prepare(`INSERT INTO password_reset_tokens(
        token_hash, user_id, expires_at, created_at
      ) VALUES(?, ?, ?, ?)`).run(hashToken(token), id, expiresAt, createdAt);
    })();
    writeAudit(database, actor, "user.password_reset.issue", "user", {
      targetId: id,
      targetLabel: user.username,
    });
    return { resetPath: `/#/reset-password/${token}`, expiresAt };
  });

  app.delete("/api/admin/users/:id", async (request, reply) => {
    const actor = principal(request);
    requireOwner(actor);
    const { id } = userIdSchema.parse(request.params);
    const user = getUser(id);
    const { confirmUsername } = z.object({ confirmUsername: z.string() }).parse(request.body);
    if (user.status !== "suspended") throw forbidden("永久删除前必须先停用用户");
    if (confirmUsername !== user.username) throw forbidden("确认用户名不匹配");
    const activeRun = database.db.prepare(`SELECT 1 FROM run_jobs WHERE status = 'running'
      AND task_id IN (SELECT id FROM tasks WHERE owner_user_id = ?) LIMIT 1`).get(id);
    if (activeRun) throw Object.assign(new Error("该用户仍有任务正在安全停止，请稍后再删除"), { statusCode: 409 });
    const screenshots = database.db.prepare(`SELECT screenshot_path FROM runs
      WHERE owner_user_id = ? AND screenshot_path IS NOT NULL`).all(id) as Array<{ screenshot_path: string }>;
    writeAudit(database, actor, "user.delete", "user", { targetId: id, targetLabel: user.username });
    database.db.prepare("DELETE FROM users WHERE id = ?").run(id);
    if (options.screenshotDir) {
      const root = path.resolve(options.screenshotDir) + path.sep;
      await Promise.allSettled(screenshots.map(({ screenshot_path }) => {
        const resolved = path.resolve(screenshot_path);
        return resolved.startsWith(root) ? unlink(resolved) : Promise.resolve();
      }));
    }
    return reply.code(204).send();
  });

  app.get("/api/admin/registration", async (request) => {
    const actor = principal(request);
    requireOwner(actor);
    const row = database.db.prepare(`SELECT registration_mode, default_user_capabilities_json,
      default_max_tasks, default_max_enabled_tasks, default_max_daily_actions
      FROM system_settings WHERE id = 1`).get() as any;
    return {
      environmentEnabled: options.registrationEnvironmentEnabled,
      mode: options.registrationEnvironmentEnabled ? row.registration_mode : "closed",
      configuredMode: row.registration_mode,
      defaultCapabilities: parseCapabilities(row.default_user_capabilities_json),
      defaultQuotas: {
        maxTasks: row.default_max_tasks,
        maxEnabledTasks: row.default_max_enabled_tasks,
        maxDailyActions: row.default_max_daily_actions,
      },
    };
  });

  app.put("/api/admin/registration", async (request) => {
    const actor = principal(request);
    requireOwner(actor);
    const body = z.object({
      mode: z.enum(["closed", "invite", "public"]),
      defaultCapabilities: capabilitySchema,
      defaultQuotas: quotaSchema,
    }).parse(request.body);
    if (!options.registrationEnvironmentEnabled && body.mode !== "closed") {
      throw Object.assign(new Error("部署环境已关闭用户注册"), { statusCode: 409 });
    }
    database.db.prepare(`UPDATE system_settings SET registration_mode = ?,
      default_user_capabilities_json = ?, default_max_tasks = ?,
      default_max_enabled_tasks = ?, default_max_daily_actions = ?, updated_at = ? WHERE id = 1`).run(
      body.mode,
      JSON.stringify(body.defaultCapabilities),
      body.defaultQuotas.maxTasks,
      body.defaultQuotas.maxEnabledTasks,
      body.defaultQuotas.maxDailyActions,
      new Date().toISOString(),
    );
    writeAudit(database, actor, "registration.update", "system", { metadata: { mode: body.mode } });
    return { success: true };
  });

  app.get("/api/admin/invites", async (request) => {
    const actor = principal(request);
    requireOwner(actor);
    const rows = database.db.prepare(`SELECT id, label, max_uses, used_count, expires_at,
      disabled_at, created_at FROM registration_invites ORDER BY created_at DESC`).all() as any[];
    return { items: rows.map((row) => ({
      id: row.id,
      label: row.label,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      expiresAt: row.expires_at || undefined,
      disabledAt: row.disabled_at || undefined,
      createdAt: row.created_at,
    })) };
  });

  app.post("/api/admin/invites", async (request, reply) => {
    const actor = principal(request);
    requireOwner(actor);
    const body = z.object({
      label: z.string().trim().max(100).default(""),
      maxUses: z.number().int().min(1).max(1_000).default(1),
      expiresAt: z.iso.datetime().optional(),
    }).parse(request.body || {});
    const code = randomBytes(18).toString("base64url");
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    database.db.prepare(`INSERT INTO registration_invites(
      id, code_hash, label, max_uses, expires_at, created_by_user_id, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?)`).run(
      id, hashToken(code), body.label, body.maxUses, body.expiresAt || null,
      actor.userId || null, createdAt,
    );
    writeAudit(database, actor, "invite.create", "invite", { targetId: id, targetLabel: body.label });
    return reply.code(201).send({ id, code, label: body.label, maxUses: body.maxUses, expiresAt: body.expiresAt, createdAt });
  });

  app.post("/api/admin/invites/:id/disable", async (request) => {
    const actor = principal(request);
    requireOwner(actor);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const changed = database.db.prepare(`UPDATE registration_invites SET disabled_at = ?
      WHERE id = ? AND disabled_at IS NULL`).run(new Date().toISOString(), id).changes;
    if (!changed) throw notFound("邀请码不存在或已停用");
    writeAudit(database, actor, "invite.disable", "invite", { targetId: id });
    return { success: true };
  });

  app.get("/api/admin/tasks", async (request) => {
    principal(request);
    const { userId } = z.object({ userId: z.uuid().optional() }).parse(request.query);
    return { items: userId ? database.listTasksByOwner(userId) : database.listTasks() };
  });

  app.post("/api/admin/tasks/:id/disable", async (request) => {
    const actor = principal(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const task = database.getTask(id);
    if (!task) throw notFound("签到任务不存在");
    database.db.prepare("UPDATE tasks SET enabled = 0, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    const active = options.queue?.jobs.getActiveForTask(id);
    if (active?.status === "queued") options.queue?.jobs.cancel(active.id);
    if (active?.status === "running") options.queue?.requestCancelTasks(new Set([id]));
    writeAudit(database, actor, "admin.task.disable", "task", { targetId: id, targetLabel: task.name });
    return database.getTask(id);
  });

  app.delete("/api/admin/tasks/:id", async (request, reply) => {
    const actor = principal(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const task = database.getTask(id);
    if (!task) throw notFound("签到任务不存在");
    const active = options.queue?.jobs.getActiveForTask(id);
    if (active?.status === "running") {
      options.queue?.requestCancelTasks(new Set([id]));
      return reply.code(409).send({ message: "已请求停止运行任务，请结束后再次删除" });
    }
    if (active?.status === "queued") options.queue?.jobs.cancel(active.id);
    database.deleteTask(id);
    writeAudit(database, actor, "admin.task.delete", "task", { targetId: id, targetLabel: task.name });
    return reply.code(204).send();
  });

  app.delete("/api/admin/tasks/:id/session", async (request, reply) => {
    const actor = principal(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const task = database.getTask(id);
    if (!task) throw notFound("签到任务不存在");
    options.sessions?.clear(id);
    writeAudit(database, actor, "admin.session.clear", "task", { targetId: id, targetLabel: task.name });
    return reply.code(204).send();
  });

  app.get("/api/admin/runs", async (request) => {
    principal(request);
    const query = z.object({ userId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query);
    const rows = query.userId
      ? database.db.prepare("SELECT * FROM runs WHERE owner_user_id = ? ORDER BY finished_at DESC LIMIT ?").all(query.userId, query.limit)
      : database.db.prepare("SELECT * FROM runs ORDER BY finished_at DESC LIMIT ?").all(query.limit);
    return { items: (rows as any[]).map((row) => ({
      ...database.getRun(row.id),
      ownerUserId: row.owner_user_id || undefined,
    })) };
  });

  app.get("/api/admin/runs/:id/screenshot", async (request, reply) => {
    principal(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const screenshotPath = database.getScreenshotPath(id);
    if (!screenshotPath || !options.screenshotDir) throw notFound("该记录没有失败截图");
    const root = path.resolve(options.screenshotDir) + path.sep;
    const resolved = path.resolve(screenshotPath);
    if (!resolved.startsWith(root)) throw forbidden("截图路径无效");
    const file = await stat(resolved).catch(() => undefined);
    if (!file?.isFile()) throw notFound("截图文件不存在");
    return reply.type("image/png").send(createReadStream(resolved));
  });

  app.get("/api/admin/audit", async (request) => {
    principal(request);
    const query = z.object({
      actorUserId: z.uuid().optional(),
      action: z.string().max(100).optional(),
      targetType: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);
    const clauses: string[] = [];
    const parameters: unknown[] = [];
    if (query.actorUserId) { clauses.push("actor_user_id = ?"); parameters.push(query.actorUserId); }
    if (query.action) { clauses.push("action = ?"); parameters.push(query.action); }
    if (query.targetType) { clauses.push("target_type = ?"); parameters.push(query.targetType); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = database.db.prepare(`SELECT * FROM audit_events ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...parameters, query.limit, query.offset) as any[];
    const items: AuditEvent[] = rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id || undefined,
      actorRole: row.actor_role,
      actorOwner: Boolean(row.actor_owner),
      actorDisplayName: row.actor_display_name,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id || undefined,
      targetLabel: row.target_label || undefined,
      result: row.result,
      metadata: JSON.parse(row.metadata_json || "{}"),
      createdAt: row.created_at,
    }));
    return { items };
  });

  app.get("/api/admin/template-submissions", async (request) => {
    principal(request);
    const { status } = z.object({
      status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
    }).parse(request.query);
    const rows = status
      ? database.db.prepare("SELECT * FROM template_submissions WHERE status = ? ORDER BY created_at DESC").all(status)
      : database.db.prepare("SELECT * FROM template_submissions ORDER BY created_at DESC").all();
    return { items: (rows as any[]).map(submissionFromRow) };
  });

  app.post("/api/admin/template-submissions/:id/review", async (request) => {
    const actor = principal(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({
      decision: z.enum(["approve", "reject"]),
      note: z.string().trim().max(500).default(""),
    }).parse(request.body);
    const row = database.db.prepare("SELECT * FROM template_submissions WHERE id = ? AND status = 'pending'")
      .get(id) as any;
    if (!row) throw notFound("待审核模板不存在");
    let publishedTemplateId: string | null = null;
    database.db.transaction(() => {
      if (body.decision === "approve") {
        publishedTemplateId = randomUUID();
        database.db.prepare(`INSERT INTO templates(
          id, owner_user_id, adapter_id, name, description, version, config,
          is_preset, is_private, is_shared, created_at, updated_at
        ) VALUES(?, NULL, 'browser_form', ?, ?, 1, ?, 0, 0, 1, ?, ?)`).run(
          publishedTemplateId,
          row.name,
          row.description,
          row.config_snapshot,
          new Date().toISOString(),
          new Date().toISOString(),
        );
      }
      database.db.prepare(`UPDATE template_submissions SET status = ?, review_note = ?,
        reviewer_user_id = ?, reviewer_name = ?, published_template_id = ?, reviewed_at = ?
        WHERE id = ?`).run(
        body.decision === "approve" ? "approved" : "rejected",
        body.note || null,
        actor.userId || null,
        actor.displayName,
        publishedTemplateId,
        new Date().toISOString(),
        id,
      );
    })();
    writeAudit(database, actor, `template_submission.${body.decision}`, "template_submission", {
      targetId: id,
      targetLabel: row.name,
    });
    return submissionFromRow(database.db.prepare("SELECT * FROM template_submissions WHERE id = ?").get(id));
  });

  app.post("/api/admin/templates/:id/unpublish", async (request) => {
    const actor = principal(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const row = database.db.prepare("SELECT name FROM templates WHERE id = ? AND is_shared = 1")
      .get(id) as { name: string } | undefined;
    if (!row) throw notFound("共享模板不存在");
    database.db.prepare("UPDATE templates SET is_shared = 0, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    writeAudit(database, actor, "template.unpublish", "template", { targetId: id, targetLabel: row.name });
    return { success: true };
  });
}

function submissionFromRow(row: any): TemplateSubmission {
  return {
    id: row.id,
    sourceTemplateId: row.source_template_id || undefined,
    submitterUserId: row.submitter_user_id || undefined,
    submitterName: row.submitter_name,
    name: row.name,
    description: row.description,
    config: normalizeBrowserFormTemplateConfig(JSON.parse(row.config_snapshot)) as BrowserFormTemplateConfig,
    status: row.status,
    reviewNote: row.review_note || undefined,
    publishedTemplateId: row.published_template_id || undefined,
    reviewedAt: row.reviewed_at || undefined,
    createdAt: row.created_at,
  };
}
