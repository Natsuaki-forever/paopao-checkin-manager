import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import type { AppConfig } from "../src/server/config.js";
import { AppDatabase } from "../src/server/database.js";
import { TaskSessionRepository } from "../src/server/repositories/task-session.js";
import { NotificationService } from "../src/server/services/notifier.js";
import { CheckinRunEngine } from "../src/server/services/run-engine.js";

describe("session API", () => {
  let directory: string;
  let database: AppDatabase;
  let sessions: TaskSessionRepository;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "checkin-session-api-"));
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 8787,
      dataDir: directory,
      databasePath: path.join(directory, "session.sqlite"),
      secretPath: path.join(directory, "secret.key"),
      isProduction: false,
      webRoot: path.join(directory, "web"),
      mode: "simulation",
      screenshotDir: path.join(directory, "screenshots"),
      legacyModulePath: path.join(directory, "unused.js"),
      features: { queue: false, session: true, httpFlow: false },
    };
    database = new AppDatabase(config.databasePath, randomBytes(32));
    sessions = new TaskSessionRepository(database.db, database.key);
    const notifier = new NotificationService(database, true);
    const engine = new CheckinRunEngine(database, "simulation", undefined, notifier, sessions);
    app = await buildApp(config, database, engine, notifier, undefined, sessions);
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("imports domain-bound cookies, returns metadata only and clears the session", async () => {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    const cookie = setup.cookies[0]!;
    const headers = { cookie: `${cookie.name}=${cookie.value}` };
    const task = database.listTasks()[0]!;
    const imported = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/session/cookies`,
      headers,
      payload: { cookie: "session_id=secret-cookie; theme=dark" },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ status: "valid" });
    const state = sessions.get(task.id)!;
    expect(state.cookies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "session_id", domain: "dash.lynvx.info", secure: true }),
    ]));

    const status = await app.inject({ method: "GET", url: `/api/tasks/${task.id}/session`, headers });
    expect(status.json()).toMatchObject({ status: "valid" });
    expect(JSON.stringify(status.json())).not.toContain("secret-cookie");

    const cleared = await app.inject({ method: "DELETE", url: `/api/tasks/${task.id}/session`, headers });
    expect(cleared.statusCode).toBe(204);
    expect(sessions.getStatus(task.id)).toEqual({ status: "none" });
  });

  it("accepts a server-side manual session token exactly once", async () => {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    const cookie = setup.cookies[0]!;
    const headers = { cookie: `${cookie.name}=${cookie.value}` };
    const task = database.listTasks()[0]!;
    const issued = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/session/manual-token`,
      headers,
    });
    expect(issued.statusCode).toBe(201);
    const { submitPath } = issued.json() as { submitPath: string };

    const submitted = await app.inject({
      method: "POST",
      url: submitPath,
      payload: { cookie: "manual_session=one-time-secret" },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toEqual({ status: "saved" });
    expect(sessions.get(task.id)?.cookies[0]).toMatchObject({
      name: "manual_session",
      domain: "dash.lynvx.info",
    });

    const reused = await app.inject({
      method: "POST",
      url: submitPath,
      payload: { cookie: "manual_session=second-value" },
    });
    expect(reused.statusCode).toBe(410);
  });
});
