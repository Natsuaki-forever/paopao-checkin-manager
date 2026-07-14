import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeBrowserFormTemplateConfig } from "../../shared/browser-form.js";
import type { TaskInput } from "../../shared/types.js";
import type { AppDatabase } from "../database.js";
import type { CheckinRunEngine } from "../services/run-engine.js";
import type { RunQueue } from "../services/run-queue.js";
import type { TaskSessionRepository } from "../repositories/task-session.js";
import { testProxyTarget } from "./settings.js";
import {
  consumeDailyAction,
  enforceTaskQuota,
  notFound,
  principalOwnerId,
  requireCapability,
  writeAudit,
} from "../services/access.js";

const selectorSchema = z.string().trim().max(500).optional();
const textListSchema = z.array(z.string().trim().min(1).max(100)).max(30).optional();
const templateConfigSchema = z.object({
  version: z.literal(1).default(1),
  usernameSelector: selectorSchema,
  passwordSelector: selectorSchema,
  loginButtonSelector: selectorSchema,
  loginSuccessSelector: selectorSchema,
  loginSuccessUrlIncludes: z.string().trim().max(500).optional(),
  checkinButtonSelector: selectorSchema,
  loginButtonTexts: textListSchema,
  checkinButtonTexts: textListSchema,
  successTexts: textListSchema,
  alreadyCheckedTexts: textListSchema,
}).optional();

const httpsUrlSchema = z.url().refine((value) => new URL(value).protocol === "https:", "只支持 HTTPS 地址");

const taskSchema = z.object({
  templateId: z.literal("browser_form").optional(),
  adapterId: z.enum(["lynvx", "browser_form"]).optional(),
  templateUuid: z.uuid().optional(),
  templateConfig: templateConfigSchema,
  name: z.string().trim().min(1, "请输入任务名称").max(80),
  loginUrl: httpsUrlSchema,
  checkinUrl: httpsUrlSchema,
  username: z.string().max(320).optional(),
  password: z.string().max(512).optional(),
  scheduleTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "执行时间格式无效"),
  timezone: z.string().trim().min(1).max(100),
  notifyServerChan: z.boolean(),
  notifyWechat: z.boolean(),
  enabled: z.boolean(),
  proxyMode: z.enum(["inherit", "direct", "custom"]).default("inherit"),
  proxyServer: z.string().trim().max(500).optional(),
  proxyUsername: z.string().max(320).optional(),
  proxyPassword: z.string().max(512).optional(),
  notificationPolicy: z.object({
    manual: z.boolean(), scheduled: z.boolean(), success: z.boolean(), failure: z.boolean(),
    failureThreshold: z.number().int().min(1).max(100), consecutiveFailures: z.number().optional(),
  }).optional(),
  retryPolicy: z.object({
    enabled: z.boolean(),
    immediateRetries: z.number().int().min(0).max(5),
    delayedRetryIntervalMinutes: z.number().int().min(1).max(720),
    delayedRetries: z.number().int().min(0).max(10),
  }).optional(),
}).superRefine((value, context) => {
  if (value.proxyMode === "custom" && !value.proxyServer) {
    context.addIssue({
      code: "custom",
      path: ["proxyServer"],
      message: "自定义代理必须填写服务器地址",
    });
  }
});

const idSchema = z.object({ id: z.uuid() });

function parseTaskInput(body: unknown): TaskInput {
  const parsed = taskSchema.parse(body);
  return {
    ...parsed,
    templateId: "browser_form",
    templateConfig: normalizeBrowserFormTemplateConfig(parsed.templateConfig),
  };
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: timezone }).format();
  } catch {
    throw new Error("时区名称无效");
  }
}

export function registerTaskRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  engine: CheckinRunEngine,
  queue?: RunQueue,
  sessions?: TaskSessionRepository,
  mode: "simulation" | "production" = "simulation",
): void {
  app.get("/api/tasks", async (request) => {
    const ownerUserId = principalOwnerId(app.getAuthPrincipal(request)!);
    return { items: database.listTasksByOwner(ownerUserId).map((task) => ({
      ...task,
      activeJob: queue?.jobs.getActiveForTask(task.id),
      sessionStatus: sessions?.getStatus(task.id),
    })) };
  });

  app.post("/api/tasks", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    const input = parseTaskInput(request.body);
    if (!input.username?.trim() || !input.password) {
      return reply.code(400).send({ message: "新任务必须填写登录用户名和密码" });
    }
    try {
      validateTimezone(input.timezone);
    } catch (error) {
      return reply.code(400).send({ message: (error as Error).message });
    }
    if (input.enabled) requireCapability(principal, "scheduleTasks");
    if (input.proxyMode === "custom") requireCapability(principal, "useCustomProxy");
    if (input.templateUuid) {
      const template = database.db.prepare(`SELECT adapter_id, owner_user_id, is_preset, is_shared
        FROM templates WHERE id = ?`).get(input.templateUuid) as {
          adapter_id: string;
          owner_user_id: string | null;
          is_preset: number;
          is_shared: number;
        } | undefined;
      const ownerUserId = principalOwnerId(principal);
      if (!template || (!template.is_preset && !template.is_shared && template.owner_user_id !== ownerUserId)) {
        throw notFound("执行模板不存在");
      }
      if (template.adapter_id === "http_flow") requireCapability(principal, "useHttpFlow");
    }
    enforceTaskQuota(database, principal, input.enabled);
    const task = database.createTask(input, principalOwnerId(principal));
    writeAudit(database, principal, "task.create", "task", {
      targetId: task.id,
      targetLabel: task.name,
    });
    return reply.code(201).send(task);
  });

  app.put("/api/tasks/:id", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    const { id } = idSchema.parse(request.params);
    const existing = database.getTaskForOwner(id, principalOwnerId(principal));
    if (!existing) throw notFound("签到任务不存在");
    const input = parseTaskInput(request.body);
    try {
      validateTimezone(input.timezone);
    } catch (error) {
      return reply.code(400).send({ message: (error as Error).message });
    }
    if (input.enabled) requireCapability(principal, "scheduleTasks");
    if (input.proxyMode === "custom") requireCapability(principal, "useCustomProxy");
    if (input.templateUuid) {
      const template = database.db.prepare(`SELECT adapter_id, owner_user_id, is_preset, is_shared
        FROM templates WHERE id = ?`).get(input.templateUuid) as {
          adapter_id: string;
          owner_user_id: string | null;
          is_preset: number;
          is_shared: number;
        } | undefined;
      const ownerUserId = principalOwnerId(principal);
      if (!template || (!template.is_preset && !template.is_shared && template.owner_user_id !== ownerUserId)) {
        throw notFound("执行模板不存在");
      }
      if (template.adapter_id === "http_flow") requireCapability(principal, "useHttpFlow");
    }
    enforceTaskQuota(database, principal, input.enabled, id);
    const task = database.updateTask(id, input);
    if (!task) return reply.code(404).send({ message: "签到任务不存在" });
    writeAudit(database, principal, "task.update", "task", {
      targetId: task.id,
      targetLabel: task.name,
    });
    return task;
  });

  app.delete("/api/tasks/:id", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    const { id } = idSchema.parse(request.params);
    const task = database.getTaskForOwner(id, principalOwnerId(principal));
    if (!task) throw notFound("签到任务不存在");
    if (queue?.jobs.getActiveForTask(id)) {
      return reply.code(409).send({ message: "任务正在排队或运行，请先取消后再删除" });
    }
    if (!database.deleteTask(id)) {
      return reply.code(404).send({ message: "签到任务不存在" });
    }
    writeAudit(database, principal, "task.delete", "task", {
      targetId: id,
      targetLabel: task.name,
    });
    return reply.code(204).send();
  });

  app.post("/api/tasks/:id/run", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    requireCapability(principal, "runTasksManually");
    const { id } = idSchema.parse(request.params);
    const task = database.getTaskForOwner(id, principalOwnerId(principal));
    if (!task) throw notFound("签到任务不存在");
    consumeDailyAction(database, principal);
    writeAudit(database, principal, "task.run.request", "task", {
      targetId: id,
      targetLabel: task.name,
    });
    if (queue) {
      const { job, created } = queue.enqueue(id, "manual");
      return reply.code(202).send({ ...job, jobId: job.id, created });
    }
    try {
      return await engine.runTask(id, "manual");
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "任务暂时无法运行",
      });
    }
  });

  app.post("/api/tasks/:id/proxy/test", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    const { id } = idSchema.parse(request.params);
    const task = database.getTaskForOwner(id, principalOwnerId(principal));
    const proxy = database.getTaskProxy(id);
    if (!task || !proxy) return reply.code(404).send({ message: "签到任务不存在" });
    const settings = database.getSettings();
    const server = proxy.mode === "custom" ? proxy.server
      : proxy.mode === "inherit" ? settings.proxyServer : undefined;
    if (!server) return reply.code(400).send({ message: "该任务未配置代理" });
    consumeDailyAction(database, principal);
    if (mode === "simulation") {
      return { success: false, simulated: true, message: "模拟模式不访问外部站点，代理配置已保存" };
    }
    const proxyUrl = new URL(server);
    if (proxy.mode === "custom" && proxy.username) {
      proxyUrl.username = proxy.username;
      proxyUrl.password = proxy.password || "";
    }
    await testProxyTarget(proxyUrl.toString(), task.checkinUrl);
    return { success: true, simulated: false, message: "代理已成功连接该任务的签到站点" };
  });
}

export { parseTaskInput, taskSchema };
