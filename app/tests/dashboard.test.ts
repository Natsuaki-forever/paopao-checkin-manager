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

describe("dashboard API", () => {
  let directory: string;
  let database: AppDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "paopao-dashboard-"));
    const config: AppConfig = {
      host: "127.0.0.1", port: 8787, dataDir: directory,
      databasePath: path.join(directory, "test.sqlite"), secretPath: path.join(directory, "secret.key"),
      isProduction: false, webRoot: path.join(directory, "web"), mode: "simulation",
      screenshotDir: path.join(directory, "screenshots"), legacyModulePath: path.join(directory, "missing.js"),
      registrationEnabled: true, features: { queue: false, session: true, httpFlow: false },
    };
    const key = randomBytes(32);
    database = new AppDatabase(config.databasePath, key, false);
    const notifier = new NotificationService(database, true);
    const sessions = new TaskSessionRepository(database.db, key);
    app = await buildApp(config, database, new CheckinRunEngine(database, "simulation", undefined, notifier), notifier, undefined, sessions);
    await app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: "owner-password-123" } });
    database.db.prepare("UPDATE system_settings SET registration_mode = 'public' WHERE id = 1").run();
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("isolates user tasks and maps the highest task attention action", async () => {
    const registration = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "dashboard_user", password: "user-password-123" } });
    expect(registration.statusCode, registration.body).toBe(201);
    const cookie = `${registration.cookies[0]!.name}=${registration.cookies[0]!.value}`;
    const created = await app.inject({
      method: "POST", url: "/api/tasks", headers: { cookie },
      payload: {
        templateId: "browser_form", templateConfig: { version: 1 }, name: "论坛每日签到",
        loginUrl: "https://example.com/login", checkinUrl: "https://example.com/checkin",
        username: "person@example.com", password: "private-password", scheduleTime: "18:30",
        timezone: "Asia/Shanghai", notifyServerChan: false, notifyWechat: false, enabled: true,
        proxyMode: "inherit",
      },
    });
    const task = created.json();
    database.insertRun({
      id: crypto.randomUUID(), taskId: task.id, taskName: task.name, trigger: "scheduled",
      status: "session_expired", message: "登录会话已失效", startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(), durationMs: 12, attempt: 1, notificationResult: "skipped",
    });
    const response = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      summary: { todayPlanned: 1, attentionCount: 1 },
      attention: [{ taskId: task.id, kind: "session_expired", action: "manual_login" }],
    });
    expect(response.json().admin).toBeUndefined();
    expect(response.body).not.toContain("private-password");
  });
});
