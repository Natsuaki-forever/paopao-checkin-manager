import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeBrowserFormTemplateConfig } from "../src/shared/browser-form.js";
import { AppDatabase } from "../src/server/database.js";

describe("database migration v1 to current", () => {
  let directory = "";

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("preserves tasks, encrypted credentials, and run records", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "checkin-migration-"));
    const databasePath = path.join(directory, "checkin.sqlite");
    const key = randomBytes(32);
    const current = new AppDatabase(databasePath, key, false);
    const task = current.createTask({
      templateId: "browser_form",
      templateConfig: normalizeBrowserFormTemplateConfig(undefined),
      name: "Existing task",
      loginUrl: "https://example.com/login",
      checkinUrl: "https://example.com/checkin",
      username: "existing@example.com",
      password: "existing-password",
      scheduleTime: "08:30",
      timezone: "Asia/Shanghai",
      notifyServerChan: true,
      notifyWechat: false,
      enabled: true,
    });
    current.insertRun({
      id: randomUUID(),
      taskId: task.id,
      taskName: task.name,
      trigger: "manual",
      status: "success",
      message: "existing run",
      startedAt: "2026-06-30T00:00:00.000Z",
      finishedAt: "2026-06-30T00:00:01.000Z",
      durationMs: 1000,
      attempt: 1,
      notificationResult: "skipped",
    });
    current.close();

    const legacy = new Database(databasePath);
    legacy.pragma("foreign_keys = OFF");
    legacy.transaction(() => {
      legacy.exec(`
        CREATE TABLE tasks_v1 (
          id TEXT PRIMARY KEY,
          adapter_id TEXT NOT NULL CHECK (adapter_id = 'lynvx'),
          name TEXT NOT NULL,
          login_url TEXT NOT NULL,
          checkin_url TEXT NOT NULL,
          username_cipher TEXT NOT NULL,
          password_cipher TEXT NOT NULL,
          username_masked TEXT NOT NULL,
          schedule_time TEXT NOT NULL,
          timezone TEXT NOT NULL,
          notify_serverchan INTEGER NOT NULL DEFAULT 0,
          notify_wechat INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO tasks_v1
        SELECT
          id, 'lynvx', name, login_url, checkin_url,
          username_cipher, password_cipher, username_masked,
          schedule_time, timezone, notify_serverchan, notify_wechat,
          enabled, created_at, updated_at
        FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_v1 RENAME TO tasks;
        CREATE TABLE sessions_v1 (
          token_hash TEXT PRIMARY KEY,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO sessions_v1(token_hash, expires_at, created_at)
          SELECT token_hash, expires_at, created_at FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_v1 RENAME TO sessions;
        DROP TABLE users;
        DROP TABLE audit_events;
        DROP TABLE usage_counters;
        DROP TABLE password_reset_tokens;
        DROP TABLE registration_invites;
        DROP TABLE template_submissions;
        DROP INDEX idx_notification_channels_owner;
        DROP INDEX idx_notification_channels_primary_owner;
        DROP INDEX idx_notification_templates_owner;
        DROP INDEX idx_notification_templates_primary_owner;
        DROP INDEX idx_daily_summary_owner;
        DROP INDEX idx_daily_summary_primary_owner;
        DROP TABLE task_sessions;
        DROP TABLE manual_session_tokens;
        DROP TABLE daily_summary_log;
        DROP TABLE task_notification_policies;
        DROP TABLE templates;
        DROP TABLE run_jobs;
        DROP INDEX idx_runs_owner_user_id_finished_at;
        ALTER TABLE runs DROP COLUMN detection_signals;
        ALTER TABLE runs DROP COLUMN final_url;
        ALTER TABLE runs DROP COLUMN phase;
        ALTER TABLE runs DROP COLUMN owner_user_id;
        ALTER TABLE system_settings DROP COLUMN proxy_tested_at;
        ALTER TABLE system_settings DROP COLUMN proxy_test_success;
        ALTER TABLE system_settings DROP COLUMN proxy_test_message;
        ALTER TABLE system_settings DROP COLUMN screenshot_max_mb;
        ALTER TABLE system_settings DROP COLUMN registration_mode;
        ALTER TABLE system_settings DROP COLUMN audit_retention_days;
        ALTER TABLE system_settings DROP COLUMN default_user_capabilities_json;
        ALTER TABLE system_settings DROP COLUMN default_max_tasks;
        ALTER TABLE system_settings DROP COLUMN default_max_enabled_tasks;
        ALTER TABLE system_settings DROP COLUMN default_max_daily_actions;
        DELETE FROM schema_migrations WHERE version >= 2;
      `);
    })();
    legacy.close();

    const migrated = new AppDatabase(databasePath, key, false);
    expect(
      migrated.db
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get(),
    ).toMatchObject({ version: 12 });
    expect(migrated.getSettings()).toMatchObject({ screenshotMaxMb: 500, registrationMode: "invite", auditRetentionDays: 180 });
    expect(migrated.listTasks()[0]).toMatchObject({
      id: task.id,
      templateId: "browser_form",
      name: "Existing task",
      templateConfig: {
        version: 1,
        checkinButtonSelector: ".claim-button",
      },
      proxyMode: "inherit",
      proxyServer: "",
      hasProxyPassword: false,
      ownerUserId: undefined,
    });
    expect(migrated.getTaskSecrets(task.id)).toEqual({
      username: "existing@example.com",
      password: "existing-password",
    });
    expect(
      migrated.db
        .prepare("SELECT COUNT(*) AS count FROM runs WHERE task_id = ?")
        .get(task.id),
    ).toMatchObject({ count: 1 });
    expect(
      migrated.db.prepare("SELECT phase, final_url, detection_signals FROM runs WHERE task_id = ?").get(task.id),
    ).toMatchObject({ phase: "checkin", final_url: null, detection_signals: "[]" });
    expect(
      migrated.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_jobs'").get(),
    ).toMatchObject({ name: "run_jobs" });
    expect(
      migrated.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_run_jobs_one_active_task'").get(),
    ).toMatchObject({ name: "idx_run_jobs_one_active_task" });
    expect(
      migrated.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_sessions'").get(),
    ).toMatchObject({ name: "task_sessions" });
    expect(
      migrated.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'manual_session_tokens'").get(),
    ).toMatchObject({ name: "manual_session_tokens" });
    expect(
      migrated.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'",
      ).get(),
    ).toMatchObject({ name: "users" });

    expect(migrated.listTasks()[0]?.templateUuid).toBeTypeOf("string");
    expect(
      migrated.db.prepare("SELECT COUNT(*) AS count FROM templates").get(),
    ).toMatchObject({ count: 3 });
    expect(
      migrated.db.prepare("SELECT name, description FROM templates WHERE is_preset = 1 ORDER BY name").all(),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Discuz 论坛签到骨架", description: expect.stringContaining("Discuz") }),
      expect.objectContaining({ name: "通用账号密码网页登录", description: expect.stringContaining("常见网页") }),
    ]));
    migrated.close();
  });
});
