import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import {
  hashPassword,
  issueSession,
  replacePassword,
  revokeSession,
  verifyPassword,
} from "../services/auth.js";
import { hashToken } from "../crypto.js";
import { writeAudit, writeAuthenticationFailure } from "../services/access.js";
import { defaultUserCapabilities } from "../../shared/types.js";

const passwordSchema = z.object({
  password: z.string().min(10, "主密码至少需要 10 个字符").max(256),
});

const usernameSchema = z.string().trim().min(3, "\u7528\u6237\u540d\u81f3\u5c11\u9700\u8981 3 \u4e2a\u5b57\u7b26").max(32)
  .regex(/^[\p{L}\p{N}._-]+$/u, "\u7528\u6237\u540d\u53ea\u80fd\u5305\u542b\u6587\u5b57\u3001\u6570\u5b57\u3001\u70b9\u3001\u4e0b\u5212\u7ebf\u6216\u77ed\u6a2a\u7ebf");
const userCredentialsSchema = z.object({
  username: usernameSchema,
  password: z.string().min(10, "\u5bc6\u7801\u81f3\u5c11\u9700\u8981 10 \u4e2a\u5b57\u7b26").max(256),
  inviteCode: z.string().trim().min(8).max(128).optional(),
});


export function registerAuthRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  isProduction: boolean,
  mode: "simulation" | "production",
  registrationEnabled: boolean,
): void {
  app.get("/api/auth/status", async (request) => {
    const principal = app.getAuthPrincipal(request);
    const registrationMode = registrationEnabled
      ? database.getSettings().registrationMode
      : "closed";
    return {
      requiresSetup: !database.isSetup(),
      authenticated: Boolean(principal),
      mode,
      registrationEnabled: registrationMode !== "closed",
      registrationMode,
      role: principal?.role,
      displayName: principal?.displayName,
      owner: principal?.owner,
      capabilities: principal?.capabilities,
      quotas: principal?.quotas,
    };
  });

  app.post(
    "/api/auth/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (database.isSetup()) {
        return reply.code(409).send({ message: "管理员主密码已经设置" });
      }
      const { password } = passwordSchema.parse(request.body);
      replacePassword(database, await hashPassword(password));
      issueSession(database, reply, isProduction, { role: "admin", displayName: "\u7ba1\u7406\u5458" });
      return { success: true };
    },
  );

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!database.isSetup()) {
        return reply.code(409).send({ message: "请先完成首次设置" });
      }
      const { password } = passwordSchema.parse(request.body);
      const row = database.db
        .prepare("SELECT password_hash FROM admin_credentials WHERE id = 1")
        .get() as { password_hash: string };
      if (!(await verifyPassword(row.password_hash, password))) {
        writeAuthenticationFailure(database, "admin_password");
        return reply.code(401).send({ message: "主密码错误" });
      }
      issueSession(database, reply, isProduction, { role: "admin", displayName: "\u7ba1\u7406\u5458" });
      return { success: true };
    },
  );

  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 3, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      if (!database.isSetup()) {
        return reply.code(409).send({ message: "请先完成首次设置" });
      }
      const registrationMode = registrationEnabled
        ? database.getSettings().registrationMode
        : "closed";
      if (registrationMode === "closed") {
        return reply.code(403).send({ message: "\u5f53\u524d\u672a\u5f00\u653e\u7528\u6237\u6ce8\u518c" });
      }
      const input = userCredentialsSchema.parse(request.body);
      const existing = database.db.prepare(
        "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE",
      ).get(input.username);
      if (existing) {
        return reply.code(409).send({ message: "\u8be5\u7528\u6237\u540d\u5df2\u88ab\u4f7f\u7528" });
      }
      if (registrationMode === "invite") {
        if (!input.inviteCode) return reply.code(400).send({ message: "请输入有效邀请码" });
        const invitation = database.db.prepare(`SELECT id FROM registration_invites
          WHERE code_hash = ? AND disabled_at IS NULL AND used_count < max_uses
          AND (expires_at IS NULL OR expires_at > ?)`).get(
          hashToken(input.inviteCode),
          new Date().toISOString(),
        ) as { id: string } | undefined;
        if (!invitation) return reply.code(400).send({ message: "邀请码无效或已过期" });
      }
      const userId = randomUUID();
      const timestamp = new Date().toISOString();
      const passwordHash = await hashPassword(input.password);
      const defaults = database.db.prepare(`SELECT default_user_capabilities_json,
        default_max_tasks, default_max_enabled_tasks, default_max_daily_actions
        FROM system_settings WHERE id = 1`).get() as {
        default_user_capabilities_json: string;
        default_max_tasks: number;
        default_max_enabled_tasks: number;
        default_max_daily_actions: number;
      };
      database.db.transaction(() => {
        if (registrationMode === "invite") {
          const consumed = database.db.prepare(`UPDATE registration_invites
            SET used_count = used_count + 1 WHERE code_hash = ? AND disabled_at IS NULL
            AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?)`)
            .run(hashToken(input.inviteCode!), timestamp);
          if (consumed.changes !== 1) throw Object.assign(new Error("邀请码无效或已被使用"), { statusCode: 409 });
        }
        database.db.prepare(`INSERT INTO users(
          id, username, password_hash, role, capabilities_json,
          max_tasks, max_enabled_tasks, max_daily_actions, created_at, updated_at
        ) VALUES(?, ?, ?, 'user', ?, ?, ?, ?, ?, ?)`).run(
          userId,
          input.username,
          passwordHash,
          defaults.default_user_capabilities_json || JSON.stringify(defaultUserCapabilities),
          defaults.default_max_tasks,
          defaults.default_max_enabled_tasks,
          defaults.default_max_daily_actions,
          timestamp,
          timestamp,
        );
        database.ensureNotificationDefaults(userId);
      })();
      issueSession(database, reply, isProduction, {
        userId,
        role: "user",
        displayName: input.username,
      });
      return reply.code(201).send({ success: true });
    },
  );

  app.post(
    "/api/auth/user-login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!database.isSetup()) {
        return reply.code(409).send({ message: "请先完成首次设置" });
      }
      const input = userCredentialsSchema.parse(request.body);
      const row = database.db.prepare(`SELECT id, username, password_hash, role, status FROM users
        WHERE username = ? COLLATE NOCASE`).get(input.username) as {
          id: string;
          username: string;
        password_hash: string;
        role: "user" | "admin";
        status: "active" | "suspended";
      } | undefined;
      if (!row || row.status !== "active" || !(await verifyPassword(row.password_hash, input.password))) {
        writeAuthenticationFailure(database, "user_password");
        return reply.code(401).send({ message: "\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef" });
      }
      database.db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), new Date().toISOString(), row.id);
      issueSession(database, reply, isProduction, {
        userId: row.id,
        role: row.role,
        displayName: row.username,
      });
      return { success: true };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    revokeSession(database, request, reply);
    return { success: true };
  });

  app.get("/api/auth/me", async (request) => ({
    authenticated: true,
    ...app.getAuthPrincipal(request),
  }));

  app.post("/api/auth/password", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    if (!principal.userId) return reply.code(403).send({ message: "主管理员请在系统设置中修改主密码" });
    const body = z.object({
      currentPassword: z.string().min(1).max(256),
      newPassword: z.string().min(10).max(256),
    }).parse(request.body);
    const row = database.db.prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(principal.userId) as { password_hash: string };
    if (!(await verifyPassword(row.password_hash, body.currentPassword))) {
      return reply.code(400).send({ message: "当前密码不正确" });
    }
    const newHash = await hashPassword(body.newPassword);
    database.db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
      .run(newHash, new Date().toISOString(), principal.userId);
    database.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(principal.userId);
    issueSession(database, reply, isProduction, {
      userId: principal.userId,
      role: principal.role,
      displayName: principal.displayName,
    });
    writeAudit(database, principal, "auth.password.change", "user", {
      targetId: principal.userId,
      targetLabel: principal.displayName,
    });
    return { success: true };
  });

  app.post("/api/auth/reset/:token", async (request, reply) => {
    const { token } = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).parse(request.params);
    const { password } = z.object({ password: z.string().min(10).max(256) }).parse(request.body);
    const row = database.db.prepare(`SELECT user_id FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`).get(
      hashToken(token),
      new Date().toISOString(),
    ) as { user_id: string } | undefined;
    if (!row) return reply.code(410).send({ message: "重置链接无效、已使用或已过期" });
    const passwordHash = await hashPassword(password);
    database.db.transaction(() => {
      database.db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?")
        .run(new Date().toISOString(), hashToken(token));
      database.db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
        .run(passwordHash, new Date().toISOString(), row.user_id);
      database.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
    })();
    return { success: true };
  });
}

export { passwordSchema };
