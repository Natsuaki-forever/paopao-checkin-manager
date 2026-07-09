import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import type { AppConfig } from "../src/server/config.js";
import { AppDatabase } from "../src/server/database.js";
import { NotificationService } from "../src/server/services/notifier.js";
import { CheckinRunEngine } from "../src/server/services/run-engine.js";
import { RunQueue } from "../src/server/services/run-queue.js";

describe("queue API", () => {
  let directory: string;
  let database: AppDatabase;
  let queue: RunQueue;
  let engine: CheckinRunEngine;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "checkin-queue-"));
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 8787,
      dataDir: directory,
      databasePath: path.join(directory, "queue.sqlite"),
      secretPath: path.join(directory, "secret.key"),
      isProduction: false,
      webRoot: path.join(directory, "web"),
      mode: "simulation",
      screenshotDir: path.join(directory, "screenshots"),
      legacyModulePath: path.join(directory, "unused.js"),
      features: { queue: true, session: false, httpFlow: false },
    };
    database = new AppDatabase(config.databasePath, randomBytes(32));
    const notifier = new NotificationService(database, true);
    engine = new CheckinRunEngine(database, "simulation", undefined, notifier);
    queue = new RunQueue(database, engine);
    queue.start();
    app = await buildApp(config, database, engine, notifier, queue);
  });

  afterEach(async () => {
    await app.close();
    await queue.stop();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("returns 202, deduplicates an active task and exposes completion", async () => {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    const cookie = setup.cookies[0]!;
    const headers = { cookie: `${cookie.name}=${cookie.value}` };
    const taskId = database.listTasks()[0]!.id;

    const first = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/run`, headers });
    const second = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/run`, headers });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ jobId: first.json().id });
    expect(second.statusCode).toBe(202);
    expect(second.json()).toMatchObject({ id: first.json().id, created: false });
    const tasks = await app.inject({ method: "GET", url: "/api/tasks", headers });
    expect(tasks.json().items[0]).toMatchObject({ activeJob: { id: first.json().id } });

    let job = first.json() as { id: string; status: string; runId?: string };
    const deadline = Date.now() + 3_000;
    while (!["succeeded", "failed"].includes(job.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const response = await app.inject({ method: "GET", url: `/api/jobs/${job.id}`, headers });
      job = response.json();
    }
    expect(job).toMatchObject({ status: "succeeded" });
    expect(job.runId).toBeTypeOf("string");
  });

  it("marks an interrupted running Job failed on startup", async () => {
    await queue.stop();
    const taskId = database.listTasks()[0]!.id;
    const job = queue.jobs.enqueue(taskId, "manual");
    queue.jobs.markRunning(job.id);
    expect(queue.start()).toBe(1);
    expect(queue.jobs.get(job.id)).toMatchObject({ status: "failed" });
  });

  it("cancels a queued Job", async () => {
    await queue.stop();
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    const cookie = setup.cookies[0]!;
    const headers = { cookie: `${cookie.name}=${cookie.value}` };
    const taskId = database.listTasks()[0]!.id;
    const created = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/run`,
      headers,
    });
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/jobs/${created.json().id}/cancel`,
      headers,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: "cancelled" });
  });

  it("keeps jobs queued while a manual login owns the browser", async () => {
    await queue.stop();
    expect(engine.beginManualLogin()).toBe(true);
    const taskId = database.listTasks()[0]!.id;
    const job = queue.enqueue(taskId, "scheduled", "manual-lock-test").job;
    queue.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(queue.jobs.get(job.id)).toMatchObject({ status: "queued" });

    engine.endManualLogin();
    const deadline = Date.now() + 2_000;
    let status = queue.jobs.get(job.id)?.status;
    while (status === "queued" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      status = queue.jobs.get(job.id)?.status;
    }
    expect(status).not.toBe("queued");
  });
});
