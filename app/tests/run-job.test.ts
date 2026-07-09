import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeBrowserFormTemplateConfig } from "../src/shared/browser-form.js";
import { AppDatabase } from "../src/server/database.js";
import { RunJobRepository } from "../src/server/repositories/run-job.js";

describe("RunJobRepository", () => {
  let directory: string;
  let database: AppDatabase;
  let taskId: string;
  let repository: RunJobRepository;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "checkin-jobs-"));
    database = new AppDatabase(path.join(directory, "jobs.sqlite"), randomBytes(32), false);
    taskId = database.createTask({
      templateId: "browser_form",
      templateConfig: normalizeBrowserFormTemplateConfig(undefined),
      name: "Queue test",
      loginUrl: "https://example.com/login",
      checkinUrl: "https://example.com/checkin",
      username: "queue@example.com",
      password: "not-persisted-in-job",
      scheduleTime: "08:00",
      timezone: "Asia/Shanghai",
      notifyServerChan: false,
      notifyWechat: false,
      enabled: true,
    }).id;
    repository = new RunJobRepository(database.db);
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("stores queue, start, heartbeat and completion timestamps", () => {
    const queued = repository.enqueue(taskId, "manual", "2026-07-01T00:00:00.000Z");
    expect(queued).toMatchObject({ status: "queued", queuedAt: "2026-07-01T00:00:00.000Z" });
    const running = repository.markRunning(queued.id, "2026-07-01T00:00:01.000Z");
    expect(running).toMatchObject({
      status: "running",
      startedAt: "2026-07-01T00:00:01.000Z",
      heartbeatAt: "2026-07-01T00:00:01.000Z",
    });
    expect(repository.heartbeat(queued.id, "2026-07-01T00:00:02.000Z").heartbeatAt)
      .toBe("2026-07-01T00:00:02.000Z");
    const finished = repository.finish(queued.id, "failed", {
      at: "2026-07-01T00:00:03.000Z",
      errorDetail: "token=must-not-leak",
    });
    expect(finished).toMatchObject({ status: "failed", finishedAt: "2026-07-01T00:00:03.000Z" });
    expect(finished.errorDetail).not.toContain("must-not-leak");
  });

  it("enforces one active job per task and permits a new job after completion", () => {
    const first = repository.enqueue(taskId, "scheduled");
    expect(() => repository.enqueue(taskId, "manual")).toThrow(/UNIQUE/);
    repository.markRunning(first.id);
    repository.finish(first.id, "succeeded");
    const next = repository.enqueue(taskId, "manual");
    expect(repository.cancel(next.id).status).toBe("cancelled");
  });

  it("rejects invalid state transitions", () => {
    const job = repository.enqueue(taskId, "manual");
    expect(() => repository.heartbeat(job.id)).toThrow(/running/i);
    expect(() => repository.finish(job.id, "succeeded")).toThrow(/running/i);
  });

  it("requeues delayed retries without occupying the worker", () => {
    const job = repository.enqueue(taskId, "manual");
    repository.markRunning(job.id);
    const retried = repository.scheduleRetry(job.id, "network", 60_000);
    expect(retried).toMatchObject({ status: "queued", retryNumber: 1, failureClass: "network" });
    expect(new Date(retried.nextRetryAt!).getTime()).toBeGreaterThan(Date.now());
    expect(repository.listQueued(10)).not.toContainEqual(expect.objectContaining({ id: job.id }));
  });
});
