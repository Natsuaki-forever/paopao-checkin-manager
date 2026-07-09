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
import { defaultUserCapabilities } from "../src/shared/types.js";

describe("0.6 RBAC and ownership", () => {
  let directory: string;
  let database: AppDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let ownerCookie: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "paopao-rbac-"));
    const config: AppConfig = {
      host: "127.0.0.1", port: 8787, dataDir: directory,
      databasePath: path.join(directory, "test.sqlite"), secretPath: path.join(directory, "secret.key"),
      isProduction: false, webRoot: path.join(directory, "web"), mode: "simulation",
      screenshotDir: path.join(directory, "screenshots"), legacyModulePath: path.join(directory, "unused.js"),
      registrationEnabled: true,
      features: { queue: false, session: false, httpFlow: false },
    };
    database = new AppDatabase(config.databasePath, randomBytes(32));
    const notifier = new NotificationService(database, true);
    app = await buildApp(config, database, new CheckinRunEngine(database, "simulation", undefined, notifier), notifier);
    const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: "owner-password-123" } });
    ownerCookie = cookie(setup);
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("isolates tasks, runs, templates and settings by owner", async () => {
    const first = await register("first_user");
    const second = await register("second_user");
    expect((await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: first } })).json().items).toEqual([]);

    const created = await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie: first }, payload: taskPayload("First task") });
    expect(created.statusCode, created.body).toBe(201);
    const taskId = created.json().id as string;
    expect(created.json().ownerUserId).toBeTypeOf("string");

    const firstTasks = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: first } });
    expect(firstTasks.json().items).toHaveLength(1);
    const secondTasks = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: second } });
    expect(secondTasks.json().items).toHaveLength(0);
    const crossRun = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/run`, headers: { cookie: second } });
    expect(crossRun.statusCode).toBe(404);
    const userSettings = await app.inject({ method: "GET", url: "/api/settings", headers: { cookie: first } });
    expect(userSettings.statusCode).toBe(403);
    const ownerTasks = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: ownerCookie } });
    expect(ownerTasks.json().items.some((item: { name: string }) => item.name === "First task")).toBe(false);
  });

  it("enforces per-user capabilities and quotas", async () => {
    const userCookie = await register("limited_user");
    const user = database.db.prepare("SELECT id FROM users WHERE username = ?").get("limited_user") as { id: string };
    const changed = await app.inject({
      method: "PATCH", url: `/api/admin/users/${user.id}`, headers: { cookie: ownerCookie },
      payload: {
        capabilities: { ...defaultUserCapabilities, runTasksManually: false, useCustomProxy: false },
        quotas: { maxTasks: 1, maxEnabledTasks: 1, maxDailyActions: 2 },
      },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const first = await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie: userCookie }, payload: taskPayload("Only task") });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie: userCookie }, payload: taskPayload("Too many") });
    expect(second.statusCode).toBe(403);
    const run = await app.inject({ method: "POST", url: `/api/tasks/${first.json().id}/run`, headers: { cookie: userCookie } });
    expect(run.statusCode).toBe(403);
  });

  it("supports owner, operational admin and suspension boundaries", async () => {
    const userCookie = await register("operator_user");
    const user = database.db.prepare("SELECT id FROM users WHERE username = ?").get("operator_user") as { id: string };
    const promoted = await app.inject({
      method: "PUT", url: `/api/admin/users/${user.id}/role`, headers: { cookie: ownerCookie }, payload: { role: "admin" },
    });
    expect(promoted.statusCode).toBe(200);
    const login = await app.inject({ method: "POST", url: "/api/auth/user-login", payload: { username: "operator_user", password: "user-password-123" } });
    const operatorCookie = cookie(login);
    expect((await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: operatorCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/admin/registration", headers: { cookie: operatorCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: `/api/admin/users/${user.id}/role`, headers: { cookie: operatorCookie }, payload: { role: "user" } })).statusCode).toBe(403);

    await app.inject({ method: "PUT", url: `/api/admin/users/${user.id}/role`, headers: { cookie: ownerCookie }, payload: { role: "user" } });
    const relogin = await app.inject({ method: "POST", url: "/api/auth/user-login", payload: { username: "operator_user", password: "user-password-123" } });
    const activeCookie = cookie(relogin);
    const suspended = await app.inject({ method: "PATCH", url: `/api/admin/users/${user.id}`, headers: { cookie: ownerCookie }, payload: { status: "suspended" } });
    expect(suspended.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: activeCookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/user-login", payload: { username: "operator_user", password: "user-password-123" } })).statusCode).toBe(401);
    expect(userCookie).toBeTruthy();
  });

  it("supports invite registration and one-time codes", async () => {
    const settings = await app.inject({ method: "GET", url: "/api/admin/registration", headers: { cookie: ownerCookie } });
    const body = settings.json();
    const updated = await app.inject({
      method: "PUT", url: "/api/admin/registration", headers: { cookie: ownerCookie },
      payload: { mode: "invite", defaultCapabilities: body.defaultCapabilities, defaultQuotas: body.defaultQuotas },
    });
    expect(updated.statusCode).toBe(200);
    const invite = await app.inject({ method: "POST", url: "/api/admin/invites", headers: { cookie: ownerCookie }, payload: { label: "test", maxUses: 1 } });
    const inviteCode = invite.json().code as string;
    expect((await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "no_invite", password: "user-password-123" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "invited_user", password: "user-password-123", inviteCode } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "reuse_invite", password: "user-password-123", inviteCode } })).statusCode).toBe(400);
  });

  it("issues one-time password reset links and revokes the old password", async () => {
    await register("reset_user");
    const user = database.db.prepare("SELECT id FROM users WHERE username = ?").get("reset_user") as { id: string };
    const issued = await app.inject({
      method: "POST", url: `/api/admin/users/${user.id}/password-reset`, headers: { cookie: ownerCookie },
    });
    expect(issued.statusCode, issued.body).toBe(200);
    const token = (issued.json().resetPath as string).split("/").at(-1)!;
    const reset = await app.inject({ method: "POST", url: `/api/auth/reset/${token}`, payload: { password: "replacement-password-123" } });
    expect(reset.statusCode, reset.body).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/auth/reset/${token}`, payload: { password: "another-password-123" } })).statusCode).toBe(410);
    expect((await app.inject({ method: "POST", url: "/api/auth/user-login", payload: { username: "reset_user", password: "user-password-123" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/user-login", payload: { username: "reset_user", password: "replacement-password-123" } })).statusCode).toBe(200);
  });

  it("publishes reviewed browser templates without exposing the source template", async () => {
    const authorCookie = await register("template_author");
    const readerCookie = await register("template_reader");
    const created = await app.inject({
      method: "POST", url: "/api/templates", headers: { cookie: authorCookie },
      payload: { name: "Community browser form", adapterId: "browser_form", config: {} },
    });
    expect(created.statusCode, created.body).toBe(201);
    const submitted = await app.inject({
      method: "POST", url: `/api/templates/${created.json().id}/submit`, headers: { cookie: authorCookie },
      payload: { description: "Reviewed shared template" },
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const reviewed = await app.inject({
      method: "POST", url: `/api/admin/template-submissions/${submitted.json().id}/review`, headers: { cookie: ownerCookie },
      payload: { decision: "approve", note: "safe browser form" },
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    const readerTemplates = (await app.inject({ method: "GET", url: "/api/templates", headers: { cookie: readerCookie } })).json().items;
    const shared = readerTemplates.find((item: { name: string }) => item.name === "Community browser form");
    expect(shared).toMatchObject({ isShared: true, adapterId: "browser_form" });
    expect(readerTemplates.some((item: { id: string }) => item.id === created.json().id)).toBe(false);
    expect((await app.inject({
      method: "PUT", url: `/api/templates/${shared.id}`, headers: { cookie: readerCookie },
      payload: { name: "tampered", adapterId: "browser_form", config: {} },
    })).statusCode).toBe(404);
  });

  async function register(username: string): Promise<string> {
    const response = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "user-password-123" } });
    expect(response.statusCode, response.body).toBe(201);
    return cookie(response);
  }
});

function cookie(response: { cookies: Array<{ name: string; value: string }> }): string {
  const value = response.cookies[0]!;
  return `${value.name}=${value.value}`;
}

function taskPayload(name: string) {
  return {
    templateId: "browser_form",
    templateConfig: { version: 1 },
    name,
    loginUrl: "https://example.com/login",
    checkinUrl: "https://example.com/checkin",
    username: "person@example.com",
    password: "task-password-123",
    scheduleTime: "08:00",
    timezone: "Asia/Shanghai",
    notifyServerChan: false,
    notifyWechat: false,
    enabled: true,
    proxyMode: "inherit",
  };
}
