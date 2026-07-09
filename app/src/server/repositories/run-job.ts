import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { RunJob, RunJobStatus, RunPhase, RunTrigger } from "../../shared/types.js";
import { redactText } from "../security/redaction.js";

interface JobRow {
  id: string;
  task_id: string;
  trigger: RunTrigger;
  status: RunJobStatus;
  phase: RunPhase;
  scheduled_key: string | null;
  queued_at: string;
  started_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
  run_id: string | null;
  error_detail: string | null;
  retry_number: number;
  next_retry_at: string | null;
  failure_class: RunJob["failureClass"] | null;
  cancel_requested: number;
}

const timestamp = () => new Date().toISOString();

function fromRow(row: JobRow): RunJob {
  return {
    id: row.id,
    taskId: row.task_id,
    trigger: row.trigger,
    status: row.status,
    phase: row.phase,
    queuedAt: row.queued_at,
    startedAt: row.started_at || undefined,
    heartbeatAt: row.heartbeat_at || undefined,
    finishedAt: row.finished_at || undefined,
    runId: row.run_id || undefined,
    errorDetail: row.error_detail || undefined,
    retryNumber: row.retry_number,
    nextRetryAt: row.next_retry_at || undefined,
    failureClass: row.failure_class || undefined,
    cancelRequested: Boolean(row.cancel_requested),
  };
}

export class RunJobRepository {
  constructor(private readonly db: Database.Database) {}

  enqueue(
    taskId: string,
    trigger: RunTrigger,
    queuedAt = timestamp(),
    scheduledKey?: string,
  ): RunJob {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO run_jobs(
      id, task_id, trigger, status, phase, scheduled_key, queued_at
    ) VALUES(?, ?, ?, 'queued', 'queued', ?, ?)`)
      .run(id, taskId, trigger, scheduledKey || null, queuedAt);
    return this.get(id)!;
  }

  enqueueOrGetActive(
    taskId: string,
    trigger: RunTrigger,
    scheduledKey?: string,
  ): { job: RunJob; created: boolean } {
    const existing = scheduledKey
      ? this.getByScheduledKey(scheduledKey)
      : this.getActiveForTask(taskId);
    if (existing) return { job: existing, created: false };
    try {
      return { job: this.enqueue(taskId, trigger, timestamp(), scheduledKey), created: true };
    } catch (error) {
      const raced = scheduledKey
        ? this.getByScheduledKey(scheduledKey)
        : this.getActiveForTask(taskId);
      if (raced) return { job: raced, created: false };
      throw error;
    }
  }

  get(id: string): RunJob | undefined {
    const row = this.db.prepare("SELECT * FROM run_jobs WHERE id = ?").get(id) as
      | JobRow
      | undefined;
    return row ? fromRow(row) : undefined;
  }

  getActiveForTask(taskId: string): RunJob | undefined {
    const row = this.db.prepare(`SELECT * FROM run_jobs
      WHERE task_id = ? AND status IN ('queued', 'running')
      ORDER BY queued_at ASC LIMIT 1`).get(taskId) as JobRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  getByScheduledKey(scheduledKey: string): RunJob | undefined {
    const row = this.db.prepare(
      "SELECT * FROM run_jobs WHERE scheduled_key = ?",
    ).get(scheduledKey) as JobRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  getScheduledKey(id: string): string | undefined {
    const row = this.db.prepare(
      "SELECT scheduled_key FROM run_jobs WHERE id = ?",
    ).get(id) as { scheduled_key: string | null } | undefined;
    return row?.scheduled_key || undefined;
  }

  listQueued(limit = 100): RunJob[] {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 1000));
    const rows = this.db.prepare(`SELECT * FROM run_jobs
      WHERE status = 'queued' AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY queued_at ASC LIMIT ?`).all(new Date().toISOString(), safeLimit) as JobRow[];
    return rows.map(fromRow);
  }

  markRunning(id: string, at = timestamp()): RunJob {
    const result = this.db.prepare(`UPDATE run_jobs SET
      status = 'running', phase = 'login', started_at = ?, heartbeat_at = ?, cancel_requested = 0
      WHERE id = ? AND status = 'queued'`).run(at, at, id);
    if (result.changes !== 1) throw new Error("Job is not queued");
    return this.get(id)!;
  }

  updatePhase(id: string, phase: Exclude<RunPhase, "queued">): RunJob {
    const result = this.db.prepare(`UPDATE run_jobs SET phase = ?
      WHERE id = ? AND status = 'running'`).run(phase, id);
    if (result.changes !== 1) throw new Error("Only a running Job can change phase");
    return this.get(id)!;
  }

  heartbeat(id: string, at = timestamp()): RunJob {
    const result = this.db.prepare(`UPDATE run_jobs SET heartbeat_at = ?
      WHERE id = ? AND status = 'running'`).run(at, id);
    if (result.changes !== 1) throw new Error("Only a running Job can heartbeat");
    return this.get(id)!;
  }

  finish(
    id: string,
    status: Extract<RunJobStatus, "succeeded" | "failed">,
    options: { at?: string; runId?: string; errorDetail?: string } = {},
  ): RunJob {
    const result = this.db.prepare(`UPDATE run_jobs SET
      status = ?, finished_at = ?, run_id = ?, error_detail = ?
      WHERE id = ? AND status = 'running'`).run(
        status,
        options.at || timestamp(),
        options.runId || null,
        options.errorDetail ? redactText(options.errorDetail) : null,
        id,
      );
    if (result.changes !== 1) throw new Error("Only a running Job can finish");
    return this.get(id)!;
  }

  cancel(id: string, at = timestamp()): RunJob {
    const result = this.db.prepare(`UPDATE run_jobs SET
      status = 'cancelled', finished_at = ?
      WHERE id = ? AND status = 'queued'`).run(at, id);
    if (result.changes !== 1) throw new Error("Only a queued Job can cancel");
    return this.get(id)!;
  }

  requestCancelForTasks(taskIds: Set<string>): number {
    if (taskIds.size === 0) return 0;
    const placeholders = [...taskIds].map(() => "?").join(",");
    return this.db.prepare(`UPDATE run_jobs SET cancel_requested = 1
      WHERE task_id IN (${placeholders}) AND status = 'running'`).run(...taskIds).changes;
  }

  finishCancelled(id: string, at = timestamp()): RunJob {
    const result = this.db.prepare(`UPDATE run_jobs SET status = 'cancelled',
      finished_at = ?, error_detail = NULL WHERE id = ? AND status = 'running'`).run(at, id);
    if (result.changes !== 1) throw new Error("Only a running Job can cancel");
    return this.get(id)!;
  }

  scheduleRetry(id: string, failureClass: NonNullable<RunJob["failureClass"]>, delayMs: number): RunJob {
    const next = new Date(Date.now() + delayMs).toISOString();
    const result = this.db.prepare(`UPDATE run_jobs SET status = 'queued', phase = 'queued',
      retry_number = retry_number + 1, next_retry_at = ?, failure_class = ?,
      started_at = NULL, heartbeat_at = NULL WHERE id = ? AND status = 'running'`)
      .run(next, failureClass, id);
    if (result.changes !== 1) throw new Error("Only a running Job can retry");
    return this.get(id)!;
  }

  recoverInterrupted(at = timestamp()): number {
    return this.db.prepare(`UPDATE run_jobs SET
      status = 'failed', finished_at = ?, error_detail = ?
      WHERE status = 'running'`).run(
        at,
        "Worker stopped before the Job completed",
      ).changes;
  }
}
