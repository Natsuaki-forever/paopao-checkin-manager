import { existsSync } from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./database.js";
import { redactText } from "./security/redaction.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerTemplateRoutes } from "./routes/templates.js";
import { registerHarRoutes } from "./routes/har.js";
import { ExecutionTemplateRepository } from "./repositories/execution-template.js";
import { getAuthPrincipal, isAuthenticated } from "./services/auth.js";
import type { NotificationService } from "./services/notifier.js";
import type { CheckinRunEngine } from "./services/run-engine.js";
import type { RunQueue } from "./services/run-queue.js";
import type { TaskSessionRepository } from "./repositories/task-session.js";
import type { ManualLoginService } from "./services/manual-login.js";
import { registerManualLoginRoutes } from "./routes/manual-login.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";

const publicApiPaths = new Set([
  "/api/health",
  "/api/auth/status",
  "/api/auth/setup",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/user-login",
]);

function isPublicApiPath(pathName: string): boolean {
  return publicApiPaths.has(pathName) || /^\/api\/(?:session\/manual|auth\/reset)\/[A-Za-z0-9_-]{43}$/.test(pathName);
}

function requestPath(url: string): string {
  return url.split("?", 1)[0] || url;
}

function hasValidOrigin(request: {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
}, publicOrigin?: string): boolean {
  const origin = request.headers.origin;
  if (!origin || Array.isArray(origin)) return true;
  if (publicOrigin) return origin === publicOrigin;
  const host = request.headers.host;
  return Boolean(host && origin === `${request.protocol}://${host}`);
}

export async function buildApp(
  config: AppConfig,
  database: AppDatabase,
  engine: CheckinRunEngine,
  notifier: NotificationService,
  queue?: RunQueue,
  sessions?: TaskSessionRepository,
  manualLogin?: ManualLoginService,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: config.isProduction });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({ message: "尝试次数过多，请稍后再试" }),
  });

  app.decorate("isAuthenticated", (request) =>
    isAuthenticated(database, request),
  );
  app.decorate("getAuthPrincipal", (request) =>
    getAuthPrincipal(database, request),
  );

  app.addHook("preHandler", async (request, reply) => {
    const pathName = requestPath(request.url);
    if (!pathName.startsWith("/api/")) return;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (!hasValidOrigin(request, config.publicOrigin)) {
        return reply.code(403).send({ message: "请求来源无效" });
      }
    }
    if (isPublicApiPath(pathName)) return;
    if (!app.isAuthenticated(request)) {
      return reply.code(401).send({ message: "登录已过期，请重新登录" });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    reply.header("Content-Security-Policy", "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'");
    if (config.isProduction) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      return reply.code(400).send({ message: first?.message || "提交的数据无效" });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    const message = redactText(error instanceof Error ? error.message : "服务器处理失败");
    return reply.code(statusCode && statusCode >= 400 ? statusCode : 500).send({ message });
  });

  app.get("/api/health", async () => ({
    ok: true,
    mode: config.mode,
  }));
  registerAuthRoutes(
    app,
    database,
    config.isProduction,
    config.mode,
    Boolean(config.registrationEnabled),
  );
  registerTaskRoutes(app, database, engine, queue, sessions, config.mode);
  registerDashboardRoutes(app, database, queue, sessions);
  registerTemplateRoutes(app, new ExecutionTemplateRepository(database.db));
  registerHarRoutes(app);
  if (queue) registerJobRoutes(app, queue, database);
  if (sessions) registerSessionRoutes(app, database, sessions);
  if (manualLogin) registerManualLoginRoutes(app, manualLogin, database);
  registerRunRoutes(app, database, config.screenshotDir);
  registerNotificationRoutes(app, database, notifier);
  registerSettingsRoutes(
    app,
    database,
    engine,
    config.isProduction,
    new Date().toISOString(),
    config.mode,
    config.screenshotDir,
    config.features || { queue: false, session: false, httpFlow: false },
  );
  registerAdminRoutes(app, database, {
    registrationEnvironmentEnabled: Boolean(config.registrationEnabled),
    queue,
    sessions,
    manualLogin,
    screenshotDir: config.screenshotDir,
  });

  const indexPath = path.join(config.webRoot, "index.html");
  if (existsSync(indexPath)) {
    await app.register(fastifyStatic, {
      root: config.webRoot,
      prefix: "/",
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ message: "接口不存在" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
