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

describe("Paopao Checkin Manager API", () => {
  let directory: string;
  let database: AppDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "checkin-demo-"));
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 8787,
      dataDir: directory,
      databasePath: path.join(directory, "test.sqlite"),
      secretPath: path.join(directory, "secret.key"),
      isProduction: false,
      webRoot: path.join(directory, "web"),
      mode: "simulation",
      screenshotDir: path.join(directory, "screenshots"),
      legacyModulePath: path.join(directory, "missing-checkin.js"),
      registrationEnabled: true,
    };
    database = new AppDatabase(config.databasePath, randomBytes(32));
    const notifier = new NotificationService(database, true);
    app = await buildApp(
      config,
      database,
      new CheckinRunEngine(database, "simulation", undefined, notifier),
      notifier,
    );
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("requires setup and creates an authenticated session", async () => {
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json()).toEqual({
      requiresSetup: true,
      authenticated: false,
      mode: "simulation",
      registrationEnabled: true,
      registrationMode: "public",
    });

    const registrationBeforeSetup = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "early_user", password: "user-password-123" },
    });
    expect(registrationBeforeSetup.statusCode).toBe(409);

    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    expect(setup.statusCode).toBe(200);
    expect(setup.cookies[0]?.name).toBe("paopao_checkin_session");
  });
  it("registers and authenticates a user account", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "paopao_user", password: "user-password-123" },
    });
    expect(registration.statusCode).toBe(201);
    const userCookie = registration.cookies[0]!;
    const userStatus = await app.inject({
      method: "GET",
      url: "/api/auth/status",
      headers: { cookie: `${userCookie.name}=${userCookie.value}` },
    });
    expect(userStatus.json()).toMatchObject({
      authenticated: true,
      role: "user",
      displayName: "paopao_user",
      registrationEnabled: true,
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "PAOPAO_USER", password: "another-password-123" },
    });
    expect(duplicate.statusCode).toBe(409);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/user-login",
      payload: { username: "paopao_user", password: "user-password-123" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.cookies[0]?.name).toBe("paopao_checkin_session");
  });



  it("does not seed demonstration tasks in production mode", () => {
    const productionDatabase = new AppDatabase(
      path.join(directory, "production.sqlite"),
      randomBytes(32),
      false,
    );
    expect(productionDatabase.listTasks()).toEqual([]);
    productionDatabase.close();
  });

  it("masks task secrets and creates simulated run records", async () => {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    const cookie = setup.cookies[0]!;
    const headers = { cookie: `${cookie.name}=${cookie.value}` };
    const tasks = await app.inject({ method: "GET", url: "/api/tasks", headers });
    const body = tasks.json() as { items: Array<{ id: string; usernameMasked: string }> };
    expect(JSON.stringify(body)).not.toContain("sample-password");
    expect(body.items[0]?.usernameMasked).toBe("s***@example.com");

    const run = await app.inject({
      method: "POST",
      url: `/api/tasks/${body.items[0]!.id}/run`,
      headers,
    });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({ status: "success", notificationResult: "simulated" });
  });

  it("accepts legacy Lynvx payloads and returns generic template configuration", async () => {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    const cookie = setup.cookies[0]!;
    const headers = { cookie: cookie.name + "=" + cookie.value };
    const legacy = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: {
        adapterId: "lynvx",
        name: "Legacy compatible",
        loginUrl: "https://example.com/login",
        checkinUrl: "https://example.com/checkin",
        username: "user@example.com",
        password: "secret-value",
        scheduleTime: "09:00",
        timezone: "Asia/Shanghai",
        notifyServerChan: false,
        notifyWechat: false,
        enabled: true,
      },
    });
    expect(legacy.statusCode, JSON.stringify(legacy.json())).toBe(201);
    expect(legacy.json()).toMatchObject({
      templateId: "browser_form",
      templateConfig: { version: 1 },
      usernameMasked: "u***@example.com",
    });
    expect(JSON.stringify(legacy.json())).not.toContain("secret-value");

    const configured = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: {
        templateId: "browser_form",
        templateConfig: {
          version: 1,
          usernameSelector: "#account",
          checkinButtonSelector: "#daily-checkin",
          successTexts: ["领取成功"],
        },
        name: "Configured",
        loginUrl: "https://example.org/login",
        checkinUrl: "https://example.org/checkin",
        username: "configured@example.org",
        password: "another-secret",
        scheduleTime: "10:00",
        timezone: "Asia/Shanghai",
        notifyServerChan: false,
        notifyWechat: false,
        enabled: true,
      },
    });
    expect(configured.statusCode).toBe(201);
    expect(configured.json()).toMatchObject({
      templateId: "browser_form",
      templateConfig: {
        version: 1,
        usernameSelector: "#account",
        checkinButtonSelector: "#daily-checkin",
      },
    });
  });
  it("rejects unsupported notification template variables", async () => {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    const cookie = setup.cookies[0]!;
    const response = await app.inject({
      method: "PUT",
      url: "/api/notifications/templates/serverchan/success",
      headers: { cookie: `${cookie.name}=${cookie.value}` },
      payload: { content: "{{password}}" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/不支持/);
  });

  it("turns a directly selected preset into a task-specific template", async () => {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    const cookie = setup.cookies[0]!;
    const headers = { cookie: `${cookie.name}=${cookie.value}` };
    const templates = (await app.inject({ method: "GET", url: "/api/templates", headers })).json().items;
    const preset = templates.find((item: { isPreset: boolean }) => item.isPreset);
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: {
        templateUuid: preset.id,
        templateId: "browser_form",
        name: "Preset based task",
        loginUrl: "https://example.net/login",
        checkinUrl: "https://example.net/checkin",
        username: "preset@example.net",
        password: "preset-secret",
        scheduleTime: "11:00",
        timezone: "Asia/Shanghai",
        notifyServerChan: false,
        notifyWechat: false,
        enabled: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().templateUuid).not.toBe(preset.id);
    const generated = database.db.prepare(
      "SELECT name, description, is_private FROM templates WHERE id = ?",
    ).get(created.json().templateUuid);
    expect(generated).toMatchObject({
      name: "Preset based task · 任务专用",
      description: expect.stringContaining(preset.name),
      is_private: 1,
    });

    await app.inject({ method: "DELETE", url: `/api/tasks/${created.json().id}`, headers });
    expect(database.db.prepare("SELECT 1 FROM templates WHERE id = ?").get(created.json().templateUuid))
      .toBeUndefined();
  });

  it("manages versioned execution templates without exporting secrets", async () => {
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { password: "a-secure-demo-password" },
    });
    const cookie = setup.cookies[0]!;
    const headers = { cookie: `${cookie.name}=${cookie.value}` };
    const created = await app.inject({
      method: "POST",
      url: "/api/templates",
      headers,
      payload: { name: "Shared template", config: { version: 1, checkinButtonSelector: "#claim" } },
    });
    expect(created.statusCode).toBe(201);
    const template = created.json();
    const updated = await app.inject({
      method: "PUT",
      url: `/api/templates/${template.id}`,
      headers,
      payload: { name: "Shared template v2", config: template.config },
    });
    expect(updated.json()).toMatchObject({ version: 2 });
    const copied = await app.inject({ method: "POST", url: `/api/templates/${template.id}/copy`, headers, payload: {} });
    expect(copied.statusCode).toBe(201);
    const exported = await app.inject({ method: "GET", url: `/api/templates/${template.id}/export`, headers });
    expect(exported.json()).toMatchObject({ schema: "browser-form-template/v1", adapterId: "browser_form" });
    expect(JSON.stringify(exported.json())).not.toMatch(/password|cookie|proxyPassword/i);
    const taskPayload = (name: string, username: string) => ({
      templateUuid: template.id,
      name,
      loginUrl: "https://example.com/login",
      checkinUrl: "https://example.com/checkin",
      username,
      password: "task-secret",
      scheduleTime: "08:00",
      timezone: "Asia/Shanghai",
      notifyServerChan: false,
      notifyWechat: false,
      enabled: true,
      proxyMode: "inherit",
    });
    const firstTask = await app.inject({ method: "POST", url: "/api/tasks", headers, payload: taskPayload("Account A", "a@example.com") });
    const secondTask = await app.inject({ method: "POST", url: "/api/tasks", headers, payload: taskPayload("Account B", "b@example.com") });
    expect(firstTask.json()).toMatchObject({ templateUuid: template.id, adapterId: "browser_form" });
    expect(secondTask.json()).toMatchObject({ templateUuid: template.id, adapterId: "browser_form" });
    const overridden = await app.inject({
      method: "PUT",
      url: `/api/tasks/${firstTask.json().id}`,
      headers,
      payload: {
        ...taskPayload("Account A", "a@example.com"),
        templateId: "browser_form",
        templateConfig: { version: 1, checkinButtonSelector: "#account-a-checkin" },
      },
    });
    expect(overridden.json()).toMatchObject({
      templateUuid: template.id,
      templateConfig: { checkinButtonSelector: "#account-a-checkin" },
    });
    expect(database.setTaskCheckinSelector(firstTask.json().id, "#visually-picked")?.templateConfig)
      .toMatchObject({ checkinButtonSelector: "#visually-picked" });
  });
});
