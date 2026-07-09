import { randomUUID } from "node:crypto";
import type { RunPhase, RunRecord, RunStatus, RunTrigger } from "../../shared/types.js";
import type { AdapterAttemptError } from "../adapters/types.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { AppDatabase } from "../database.js";
import type { TaskSessionRepository } from "../repositories/task-session.js";
import { redactText, redactUrl, sanitizeSignals } from "../security/redaction.js";
import type { NotificationService } from "./notifier.js";

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class CheckinRunEngine {
  private running = false;
  private manualLogin = false;
  private currentTaskId?: string;
  private readonly cancellationRequests = new Set<string>();

  constructor(
    private readonly database: AppDatabase,
    private readonly mode: "simulation" | "production" = "simulation",
    private readonly adapters?: AdapterRegistry,
    private readonly notifier?: NotificationService,
    private readonly sessions?: TaskSessionRepository,
  ) {}

  get activeRuns(): number {
    return Number(this.running);
  }

  get manualLoginActive(): boolean {
    return this.manualLogin;
  }

  beginManualLogin(): boolean {
    if (this.running || this.manualLogin) return false;
    this.manualLogin = true;
    return true;
  }

  endManualLogin(): void {
    this.manualLogin = false;
  }

  requestCancellation(taskId: string): boolean {
    if (this.currentTaskId !== taskId) return false;
    this.cancellationRequests.add(taskId);
    return true;
  }

  async runTask(
    taskId: string,
    trigger: RunTrigger,
    scheduledKey?: string,
    onPhase?: (phase: Exclude<RunPhase, "queued">) => void | Promise<void>,
  ): Promise<RunRecord | undefined> {
    if (scheduledKey) {
      const exists = this.database.db
        .prepare("SELECT 1 FROM runs WHERE scheduled_key = ?")
        .get(scheduledKey);
      if (exists) return undefined;
    }
    if (this.running || this.manualLogin) {
      throw new Error(this.manualLogin
        ? "正在进行人工登录，完成或取消后再运行任务"
        : "另一个签到任务正在运行，请稍后再试");
    }
    const task = this.database.getTask(taskId);
    if (!task) throw new Error("签到任务不存在");

    this.running = true;
    this.currentTaskId = taskId;
    const guardedPhase = async (phase: Exclude<RunPhase, "queued">) => {
      if (this.cancellationRequests.has(taskId)) throw new RunCancelledError();
      await onPhase?.(phase);
      if (this.cancellationRequests.has(taskId)) throw new RunCancelledError();
    };
    try {
      await guardedPhase(this.mode === "production" ? "login" : "checkin");
      let record = this.mode === "production"
        ? await this.runProduction(task.id, task.name, trigger, guardedPhase)
        : await this.runSimulation(task.id, task.name, trigger);
      if (this.cancellationRequests.has(taskId)) {
        record = cancelledRecord(task.id, task.name, trigger, record.startedAt);
      }
      this.database.recordTaskOutcome(
        task.id,
        record.status === "success" || record.status === "already_checked",
      );
      if (this.notifier && record.status !== "cancelled") {
        await guardedPhase("notify");
        record.phase = "notify";
        record.notificationResult = await this.notifier.sendForRun(task, record);
      }
      this.database.insertRun(record, scheduledKey);
      return record;
    } finally {
      this.running = false;
      this.currentTaskId = undefined;
      this.cancellationRequests.delete(taskId);
    }
  }

  private async runSimulation(
    taskId: string,
    taskName: string,
    trigger: RunTrigger,
  ): Promise<RunRecord> {
    const startedAt = new Date();
    await wait(850);
    const finishedAt = new Date();
    return {
      id: randomUUID(),
      taskId,
      taskName,
      trigger,
      status: "success",
      message: "模拟结果：签到成功，未访问目标网站",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      attempt: 1,
      notificationResult: "skipped",
      phase: "checkin",
    };
  }

  private async runProduction(
    taskId: string,
    taskName: string,
    trigger: RunTrigger,
    onPhase?: (phase: Exclude<RunPhase, "queued">) => void | Promise<void>,
  ): Promise<RunRecord> {
    if (!this.adapters) throw new Error("真实签到适配器尚未初始化");
    const task = this.database.getTask(taskId)!;
    const adapter = this.adapters.get(task.templateId);
    const credentials = this.database.getTaskSecrets(taskId);
    if (!credentials) throw new Error("签到任务凭据不存在");
    const settings = this.database.getSettings();
    const taskProxy = this.database.getTaskProxy(taskId);
    const resolvedProxy = taskProxy?.mode === "direct"
      ? undefined
      : taskProxy?.mode === "custom" && taskProxy.server
        ? { server: taskProxy.server, username: taskProxy.username, password: taskProxy.password }
        : settings.proxyServer ? { server: settings.proxyServer } : undefined;
    const storedSession = this.sessions?.getStatus(taskId).status === "valid"
      ? this.sessions.get(taskId)
      : undefined;
    const maxAttempts = settings.retryCount + 1;
    const overallStartedAt = new Date();
    let finalAttempt = 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      finalAttempt = attempt;
      try {
        const result = await adapter.run(
          task,
          credentials,
          settings,
          attempt,
          onPhase,
          storedSession ? JSON.stringify(storedSession) : undefined,
          resolvedProxy,
          () => this.cancellationRequests.has(taskId),
        );
        if (result.storageState && this.sessions) {
          this.sessions.save(taskId, JSON.parse(result.storageState));
        }
        return {
          id: randomUUID(),
          taskId,
          taskName,
          trigger,
          status:
            result.status === "retryable_failure" ? "failure" : result.status,
          message: redactText(result.message),
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          durationMs:
            new Date(result.finishedAt).getTime() -
            new Date(result.startedAt).getTime(),
          attempt,
          notificationResult: "skipped",
          screenshotPath: result.screenshot,
          phase: "checkin",
          finalUrl: result.finalUrl ? redactUrl(result.finalUrl) : undefined,
          detectionSignals: sanitizeSignals(result.detectionSignals),
        };
      } catch (error) {
        if (error instanceof RunCancelledError) {
          return cancelledRecord(taskId, taskName, trigger, overallStartedAt.toISOString());
        }
        const adapterError = error as AdapterAttemptError;
        if (adapterError.status === "session_expired") {
          this.sessions?.markExpired(taskId);
        }
        if (adapterError.retryable && attempt < maxAttempts) {
          await wait(settings.retryDelayMs);
          continue;
        }
        const finishedAt = new Date();
        return {
          id: randomUUID(),
          taskId,
          taskName,
          trigger,
          status: normalizeStatus(adapterError.status),
          message: redactText(adapterError.message || "真实签到执行失败"),
          startedAt: overallStartedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - overallStartedAt.getTime(),
          attempt: finalAttempt,
          notificationResult: "skipped",
          errorDetail: adapterError.message ? redactText(adapterError.message) : undefined,
          phase: "checkin",
          finalUrl: adapterError.finalUrl ? redactUrl(adapterError.finalUrl) : undefined,
          detectionSignals: sanitizeSignals(adapterError.detectionSignals),
          screenshotPath: adapterError.screenshot,
        };
      }
    }
    throw new Error("签到重试流程意外结束");
  }
}

class RunCancelledError extends Error {
  constructor() {
    super("任务已由管理员停止");
  }
}

function cancelledRecord(
  taskId: string,
  taskName: string,
  trigger: RunTrigger,
  startedAt: string,
): RunRecord {
  const finishedAt = new Date().toISOString();
  return {
    id: randomUUID(),
    taskId,
    taskName,
    trigger,
    status: "cancelled",
    message: "任务已由管理员停止",
    startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    attempt: 1,
    notificationResult: "skipped",
    phase: "checkin",
  };
}

function normalizeStatus(status: AdapterAttemptError["status"]): RunStatus {
  if (
    status === "auth_required" ||
    status === "challenge" ||
    status === "page_changed"
    || status === "session_expired"
    || status === "proxy_failure"
    || status === "cancelled"
  ) {
    return status;
  }
  return "failure";
}
