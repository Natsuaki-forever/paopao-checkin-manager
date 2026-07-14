import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServiceStatus, StorageUsage, SystemSettings } from "../../shared/types.js";
import { APP_VERSION } from "../../shared/version.js";
import type { AppDatabase } from "../database.js";
import {
  hashPassword,
  issueSession,
  replacePassword,
  verifyPassword,
} from "../services/auth.js";
import type { CheckinRunEngine } from "../services/run-engine.js";
import { cleanupRunArtifacts, getStorageUsage } from "../services/run-retention.js";
import { requireAdmin, requireOwner, writeAudit } from "../services/access.js";
import { assertSafeProxyUrl, assertSafeUrl } from "../security/network.js";

const settingsSchema = z.object({
  retryCount: z.number().int().min(0).max(10),
  retryDelayMs: z.number().int().min(0).max(300_000),
  navigationTimeoutMs: z.number().int().min(1_000).max(300_000),
  actionTimeoutMs: z.number().int().min(1_000).max(300_000),
  retentionDays: z.number().int().min(1).max(365),
  screenshotMaxMb: z.number().int().min(10).max(10_000),
  proxyServer: z.string().trim().max(500),
  sessionHours: z.number().int().min(1).max(168),
  registrationMode: z.enum(["closed", "invite", "public"]),
  auditRetentionDays: z.number().int().min(30).max(365),
});

export function registerSettingsRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  engine: CheckinRunEngine,
  isProduction: boolean,
  startedAt: string,
  mode: "simulation" | "production",
  screenshotDir?: string,
  features: { queue: boolean; session: boolean; httpFlow: boolean } = { queue: false, session: false, httpFlow: false },
): void {
  app.get("/api/settings", async (request) => {
    requireOwner(app.getAuthPrincipal(request)!);
    return database.getSettings();
  });

  app.put("/api/settings", async (request) => {
    const principal = app.getAuthPrincipal(request)!;
    requireOwner(principal);
    const settings = settingsSchema.parse(request.body) as SystemSettings;
    if (settings.proxyServer) await assertSafeProxyUrl(settings.proxyServer);
    database.db
      .prepare(`UPDATE system_settings SET
        retry_count = ?, retry_delay_ms = ?, navigation_timeout_ms = ?,
        action_timeout_ms = ?, retention_days = ?, screenshot_max_mb = ?,
        proxy_tested_at = CASE WHEN proxy_server = ? THEN proxy_tested_at ELSE NULL END,
        proxy_test_success = CASE WHEN proxy_server = ? THEN proxy_test_success ELSE NULL END,
        proxy_test_message = CASE WHEN proxy_server = ? THEN proxy_test_message ELSE NULL END,
        proxy_server = ?,
        session_hours = ?, registration_mode = ?, audit_retention_days = ?,
        updated_at = ? WHERE id = 1`)
      .run(
        settings.retryCount,
        settings.retryDelayMs,
        settings.navigationTimeoutMs,
        settings.actionTimeoutMs,
        settings.retentionDays,
        settings.screenshotMaxMb,
        settings.proxyServer,
        settings.proxyServer,
        settings.proxyServer,
        settings.proxyServer,
        settings.sessionHours,
        settings.registrationMode,
        settings.auditRetentionDays,
        new Date().toISOString(),
      );
    if (screenshotDir) await cleanupRunArtifacts(database, screenshotDir);
    else database.cleanupRuns();
    writeAudit(database, principal, "settings.update", "system");
    return database.getSettings();
  });

  app.get("/api/settings/storage", async (request) => {
    requireAdmin(app.getAuthPrincipal(request)!);
    if (!screenshotDir) throw Object.assign(new Error("截图目录未配置"), { statusCode: 503 });
    return await getStorageUsage(database, screenshotDir) satisfies StorageUsage;
  });

  app.get("/api/settings/status", async (request) => {
    requireAdmin(app.getAuthPrincipal(request)!);
    const settings = database.getSettings();
    const proxyTest = database.db.prepare(`SELECT proxy_tested_at, proxy_test_success,
      proxy_test_message FROM system_settings WHERE id = 1`).get() as {
        proxy_tested_at: string | null;
        proxy_test_success: number | null;
        proxy_test_message: string | null;
      };
    return {
      mode,
      version: APP_VERSION,
      scheduler: "running",
      database: "connected",
      proxy: !settings.proxyServer
        ? "not_configured"
        : !proxyTest.proxy_tested_at
          ? "configured_not_tested"
          : proxyTest.proxy_test_success
            ? "configured_tested"
            : "configured_failed",
      proxyTestedAt: proxyTest.proxy_tested_at || undefined,
      proxyTestMessage: proxyTest.proxy_test_message || undefined,
      activeRuns: engine.activeRuns,
      startedAt,
      features,
    } satisfies ServiceStatus;
  });

  app.post("/api/settings/proxy/test", async (request) => {
    const principal = app.getAuthPrincipal(request)!;
    requireOwner(principal);
    const proxyServer = database.getSettings().proxyServer;
    const configured = Boolean(proxyServer);
    if (mode === "production" && configured) {
      const target = database.listTasks().find((task) => task.enabled)?.checkinUrl;
      if (!target) throw Object.assign(new Error("没有可用于代理检测的启用任务"), { statusCode: 400 });
      try {
        await testProxyTarget(proxyServer, target);
      } catch (error) {
        const message = error instanceof Error ? error.message : "代理检测失败";
        database.db.prepare(`UPDATE system_settings SET proxy_tested_at = ?,
          proxy_test_success = 0, proxy_test_message = ? WHERE id = 1`)
          .run(new Date().toISOString(), message);
        throw error;
      }
      database.db.prepare(`UPDATE system_settings SET proxy_tested_at = ?,
        proxy_test_success = 1, proxy_test_message = ? WHERE id = 1`)
        .run(new Date().toISOString(), "代理已成功连接目标签到站点");
      return {
        success: true,
        simulated: false,
        message: "代理已成功连接目标签到站点",
      };
    }
    return {
      success: false,
      simulated: mode === "simulation",
      message: configured
        ? "模拟模式不发起外部代理连接，配置已保存但未测试"
        : "尚未配置代理地址",
    };
  });

  app.post("/api/settings/password", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    requireOwner(principal);
    const body = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(10).max(256),
      })
      .parse(request.body);
    const row = database.db
      .prepare("SELECT password_hash FROM admin_credentials WHERE id = 1")
      .get() as { password_hash: string };
    if (!(await verifyPassword(row.password_hash, body.currentPassword))) {
      return reply.code(400).send({ message: "当前主密码不正确" });
    }
    replacePassword(database, await hashPassword(body.newPassword));
    issueSession(database, reply, isProduction);
    writeAudit(database, principal, "owner.password.change", "system");
    return { success: true };
  });
}

export { settingsSchema };

export async function testProxyTarget(proxyServer: string, targetUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(proxyServer);
  } catch {
    throw Object.assign(new Error("代理地址格式无效"), { statusCode: 400 });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error("代理检测目前支持 HTTP/HTTPS 代理"), { statusCode: 400 });
  }
  await assertSafeProxyUrl(proxyServer);
  const target = await assertSafeUrl(targetUrl);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error("代理服务连接超时"), { statusCode: 502 }));
    }, 5_000);
    socket.once("connect", () => {
      const targetPort = target.port || (target.protocol === "https:" ? "443" : "80");
      const authorization = url.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}\r\n`
        : "";
      socket.write(
        `CONNECT ${target.hostname}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${target.hostname}:${targetPort}\r\n${authorization}Connection: close\r\n\r\n`,
      );
    });
    let response = "";
    socket.on("data", (chunk) => {
      response += chunk.toString("latin1");
      if (response.length > 8_192) socket.destroy(new Error("代理响应过大"));
      if (!response.includes("\r\n\r\n")) return;
      clearTimeout(timer);
      socket.destroy();
      if (/^HTTP\/1\.[01] 2\d\d\b/.test(response)) resolve();
      else reject(Object.assign(new Error("代理无法连接目标签到站点"), { statusCode: 502 }));
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(`代理服务连接失败：${error.message}`), { statusCode: 502 }));
    });
  });
}
import net from "node:net";
