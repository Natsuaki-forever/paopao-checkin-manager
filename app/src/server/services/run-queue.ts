import type { RunJob, RunTrigger } from "../../shared/types.js";
import type { AppDatabase } from "../database.js";
import { RunJobRepository } from "../repositories/run-job.js";
import { redactText } from "../security/redaction.js";
import type { CheckinRunEngine } from "./run-engine.js";
import { zonedMinute } from "./next-run.js";

export class RunQueue {
  readonly jobs: RunJobRepository;
  private stopped = true;
  private drainPromise?: Promise<void>;
  private wakeTimer?: NodeJS.Timeout;

  constructor(
    private readonly database: AppDatabase,
    private readonly engine: CheckinRunEngine,
  ) {
    this.jobs = new RunJobRepository(database.db);
  }

  start(): number {
    if (!this.stopped) return 0;
    const recovered = this.jobs.recoverInterrupted();
    this.stopped = false;
    this.wakeTimer = setInterval(() => this.wake(), 1_000);
    this.wakeTimer.unref();
    this.wake();
    return recovered;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.wakeTimer) clearInterval(this.wakeTimer);
    this.wakeTimer = undefined;
    await this.drainPromise;
  }

  requestCancelTasks(taskIds: Set<string>): number {
    const requested = this.jobs.requestCancelForTasks(taskIds);
    for (const taskId of taskIds) this.engine.requestCancellation(taskId);
    return requested;
  }

  enqueue(
    taskId: string,
    trigger: RunTrigger,
    scheduledKey?: string,
  ): { job: RunJob; created: boolean } {
    const result = this.jobs.enqueueOrGetActive(taskId, trigger, scheduledKey);
    this.wake();
    return result;
  }

  private wake(): void {
    if (this.stopped || this.drainPromise) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = undefined;
      if (!this.stopped && !this.engine.manualLoginActive && this.jobs.listQueued(1).length > 0) this.wake();
    });
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      if (this.engine.manualLoginActive) return;
      const queued = this.jobs.listQueued(1)[0];
      if (!queued) return;
      let heartbeat: NodeJS.Timeout | undefined;
      try {
        this.jobs.markRunning(queued.id);
        heartbeat = setInterval(() => {
          try {
            this.jobs.heartbeat(queued.id);
          } catch {
            // Completion or shutdown can race a heartbeat tick.
          }
        }, 5_000);
        heartbeat.unref();
        const task = this.database.getTask(queued.taskId);
        if (!task) throw new Error("签到任务不存在");
        const retryNumber = queued.retryNumber || 0;
        const policy = task.retryPolicy;
        const finalDelayedAttempt = retryNumber >= policy.delayedRetries;
        const record = await this.engine.runTask(
          queued.taskId,
          queued.trigger,
          runKey(this.jobs.getScheduledKey(queued.id), retryNumber),
          async (phase) => {
            if (this.jobs.get(queued.id)?.cancelRequested) {
              this.engine.requestCancellation(queued.taskId);
            }
            this.jobs.updatePhase(queued.id, phase);
          },
          {
            immediateRetries: queued.trigger === "scheduled" && retryNumber === 0 && policy.enabled
              ? policy.immediateRetries : 0,
            notificationMode: retryNumber === 0 || finalDelayedAttempt ? "all" : "success-only",
          },
        );
        if (record?.status === "cancelled") {
          this.jobs.finishCancelled(queued.id);
        } else if (record && !["success", "already_checked"].includes(record.status)) {
          const failureClass = classifyFailure(record.status, record.message);
          const maxRetries = policy.enabled && ["network", "proxy", "page", "assertion"].includes(failureClass)
            ? policy.delayedRetries : 0;
          const delayMs = policy.delayedRetryIntervalMinutes * 60_000;
          if (retryNumber < maxRetries && retryStaysToday(queued, task.timezone, delayMs)) {
            this.jobs.scheduleRetry(queued.id, failureClass, delayMs);
          } else {
            this.jobs.finish(queued.id, "failed", { runId: record.id, errorDetail: record.message });
          }
        } else if (record) {
          this.jobs.finish(queued.id, "succeeded", { runId: record?.id });
        } else {
          this.jobs.finish(queued.id, "failed", { errorDetail: "未生成签到运行记录，已安全停止" });
        }
      } catch (error) {
        const current = this.jobs.get(queued.id);
        if (current?.status === "running") {
          this.jobs.finish(queued.id, "failed", {
            errorDetail: redactText(
              error instanceof Error ? error.message : "Job execution failed",
            ),
          });
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }
    }
  }
}

function runKey(scheduledKey: string | undefined, retryNumber: number): string | undefined {
  return scheduledKey ? `${scheduledKey}:attempt:${retryNumber}` : undefined;
}

function retryStaysToday(job: RunJob, timezone: string, delayMs: number): boolean {
  const scheduledDate = job.scheduledKey?.split(":")[1];
  if (!scheduledDate) return false;
  const next = zonedMinute(new Date(Date.now() + delayMs), timezone);
  return next.date === scheduledDate && next.time <= "23:59";
}

function classifyFailure(status: string, message: string): NonNullable<RunJob["failureClass"]> {
  if (status === "proxy_failure") return "proxy";
  if (status === "challenge") return "challenge";
  if (status === "auth_required" || status === "session_expired") return "auth";
  if (status === "page_changed") return "page";
  if (/assert|unexpected http|response does not|forbidden/i.test(message)) return "assertion";
  return "network";
}
