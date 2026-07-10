import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  NotificationChannel,
  RunRecord,
  RunStatus,
  RunTrigger,
  SystemSettings,
  TaskInput,
  TaskSummary,
  TemplateStatus,
} from "../shared/types.js";
import { defaultUserCapabilities } from "../shared/types.js";
import { normalizeBrowserFormTemplateConfig } from "../shared/browser-form.js";
import { decryptSecret, encryptSecret, maskUsername } from "./crypto.js";
import { nextRunInfo } from "./services/next-run.js";

const defaultTemplates: Record<TemplateStatus, string> = {
  success:
    "{{siteName}} {{status}}\n\n结果：{{message}}\n完成时间：{{finishedAt}}\n耗时：{{duration}}",
  already_checked:
    "{{siteName}} {{status}}\n\n结果：{{message}}\n完成时间：{{finishedAt}}\n耗时：{{duration}}",
  failure:
    "{{siteName}} {{status}}\n\n结果：{{message}}\n完成时间：{{finishedAt}}\n耗时：{{duration}}",
};

interface TaskRow {
  id: string;
  owner_user_id: string | null;
  adapter_id: "browser_form" | "http_flow";
  template_config: string;
  template_uuid: string | null;
  name: string;
  login_url: string;
  checkin_url: string;
  username_cipher: string;
  password_cipher: string;
  username_masked: string;
  schedule_time: string;
  timezone: string;
  notify_serverchan: number;
  notify_wechat: number;
  enabled: number;
  proxy_mode: "inherit" | "direct" | "custom";
  proxy_server: string;
  proxy_username_cipher: string | null;
  proxy_password_cipher: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  owner_user_id: string | null;
  task_id: string | null;
  task_name: string;
  phase: "queued" | "login" | "checkin" | "notify";
  final_url: string | null;
  detection_signals: string;
  trigger: RunTrigger;
  status: RunStatus;
  message: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  attempt: number;
  notification_result: "sent" | "simulated" | "skipped" | "failed";
  error_detail: string | null;
  screenshot_path: string | null;
}

function now(): string {
  return new Date().toISOString();
}

function templateConfigFromRow(row: TaskRow) {
  try {
    return normalizeBrowserFormTemplateConfig(
      JSON.parse(row.template_config) as Record<string, unknown>,
    );
  } catch {
    return normalizeBrowserFormTemplateConfig(undefined);
  }
}

function runFromRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id || undefined,
    taskId: row.task_id || undefined,
    taskName: row.task_name,
    trigger: row.trigger,
    status: row.status,
    message: row.message,
    phase: row.phase,
    finalUrl: row.final_url || undefined,
    detectionSignals: JSON.parse(row.detection_signals) as string[],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    attempt: row.attempt,
    notificationResult: row.notification_result,
    errorDetail: row.error_detail || undefined,
    hasScreenshot: Boolean(row.screenshot_path),
  };
}

export class AppDatabase {
  readonly db: Database.Database;
  readonly key: Buffer;

  constructor(databasePath: string, key: Buffer, seedSampleData = true) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.key = key;
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.seed(seedSampleData);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    let version = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number };

    if (version.version < 1) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE admin_credentials (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE sessions (
            token_hash TEXT PRIMARY KEY,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE tasks (
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
          CREATE TABLE runs (
            id TEXT PRIMARY KEY,
            task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            task_name TEXT NOT NULL,
            trigger TEXT NOT NULL,
            scheduled_key TEXT UNIQUE,
            status TEXT NOT NULL,
            message TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            attempt INTEGER NOT NULL,
            notification_result TEXT NOT NULL,
            error_detail TEXT,
            screenshot_path TEXT
          );
          CREATE INDEX idx_runs_finished_at ON runs(finished_at DESC);
          CREATE INDEX idx_runs_task_id ON runs(task_id);
          CREATE TABLE notification_channels (
            channel TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 0,
            secret_cipher TEXT,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE notification_templates (
            channel TEXT NOT NULL,
            status TEXT NOT NULL,
            content TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(channel, status)
          );
          CREATE TABLE system_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            retry_count INTEGER NOT NULL,
            retry_delay_ms INTEGER NOT NULL,
            navigation_timeout_ms INTEGER NOT NULL,
            action_timeout_ms INTEGER NOT NULL,
            retention_days INTEGER NOT NULL,
            proxy_server TEXT NOT NULL,
            session_hours INTEGER NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        this.db
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)")
          .run(now());
      })();
      version = { version: 1 };
    }

    if (version.version < 2) {
      const migratedConfig = JSON.stringify(
        normalizeBrowserFormTemplateConfig({
          version: 1,
          checkinButtonSelector: ".claim-button",
        }),
      );
      this.db.pragma("foreign_keys = OFF");
      try {
        this.db.transaction(() => {
          this.db.exec(`
            CREATE TABLE tasks_v2 (
              id TEXT PRIMARY KEY,
              adapter_id TEXT NOT NULL,
              template_config TEXT NOT NULL,
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
          `);
          this.db.prepare(`
            INSERT INTO tasks_v2(
              id, adapter_id, template_config, name, login_url, checkin_url,
              username_cipher, password_cipher, username_masked,
              schedule_time, timezone, notify_serverchan, notify_wechat,
              enabled, created_at, updated_at
            )
            SELECT
              id, 'browser_form', ?, name, login_url, checkin_url,
              username_cipher, password_cipher, username_masked,
              schedule_time, timezone, notify_serverchan, notify_wechat,
              enabled, created_at, updated_at
            FROM tasks
          `).run(migratedConfig);
          this.db.exec(`
            DROP TABLE tasks;
            ALTER TABLE tasks_v2 RENAME TO tasks;
          `);
          this.db
            .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(2, ?)")
            .run(now());
        })();
      } finally {
        this.db.pragma("foreign_keys = ON");
      }
    }

    if (version.version < 3) {
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE runs ADD COLUMN phase TEXT NOT NULL DEFAULT 'checkin'
            CHECK (phase IN ('queued', 'login', 'checkin', 'notify'));
          ALTER TABLE runs ADD COLUMN final_url TEXT;
          ALTER TABLE runs ADD COLUMN detection_signals TEXT NOT NULL DEFAULT '[]';

          CREATE TABLE run_jobs (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
            status TEXT NOT NULL CHECK (
              status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
            ),
            phase TEXT NOT NULL DEFAULT 'queued'
              CHECK (phase IN ('queued', 'login', 'checkin', 'notify')),
            scheduled_key TEXT UNIQUE,
            queued_at TEXT NOT NULL,
            started_at TEXT,
            heartbeat_at TEXT,
            finished_at TEXT,
            run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
            error_detail TEXT,
            CHECK (status != 'running' OR started_at IS NOT NULL),
            CHECK (status NOT IN ('succeeded', 'failed', 'cancelled') OR finished_at IS NOT NULL)
          );
          CREATE UNIQUE INDEX idx_run_jobs_one_active_task
            ON run_jobs(task_id)
            WHERE status IN ('queued', 'running');
          CREATE INDEX idx_run_jobs_status_queued_at
            ON run_jobs(status, queued_at);
          CREATE INDEX idx_run_jobs_run_id ON run_jobs(run_id);
        `);
        this.db
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(3, ?)")
          .run(now());
      })();
    }

    if (version.version < 4) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE task_sessions (
            task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
            state_cipher TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'valid'
              CHECK (status IN ('valid', 'expired')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          ALTER TABLE tasks ADD COLUMN proxy_mode TEXT NOT NULL DEFAULT 'inherit'
            CHECK (proxy_mode IN ('inherit', 'direct', 'custom'));
          ALTER TABLE tasks ADD COLUMN proxy_server TEXT NOT NULL DEFAULT '';
          ALTER TABLE tasks ADD COLUMN proxy_username_cipher TEXT;
          ALTER TABLE tasks ADD COLUMN proxy_password_cipher TEXT;
        `);
        this.db
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(4, ?)")
          .run(now());
      })();
    }

    if (version.version < 5) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE templates (
            id TEXT PRIMARY KEY,
            adapter_id TEXT NOT NULL CHECK (adapter_id IN ('browser_form', 'http_flow')),
            name TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            config TEXT NOT NULL,
            is_preset INTEGER NOT NULL DEFAULT 0,
            is_private INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            tested_at TEXT
          );
          ALTER TABLE tasks ADD COLUMN template_uuid TEXT REFERENCES templates(id) ON DELETE SET NULL;
          CREATE INDEX idx_tasks_template_uuid ON tasks(template_uuid);
        `);
        const rows = this.db.prepare(
          "SELECT id, name, template_config, created_at, updated_at FROM tasks",
        ).all() as Array<{ id: string; name: string; template_config: string; created_at: string; updated_at: string }>;
        for (const row of rows) {
          const templateId = randomUUID();
          this.db.prepare(`INSERT INTO templates(
            id, adapter_id, name, version, config, is_private, created_at, updated_at
          ) VALUES(?, 'browser_form', ?, 1, ?, 1, ?, ?)`)
            .run(templateId, `${row.name} 私有模板`, row.template_config, row.created_at, row.updated_at);
          this.db.prepare("UPDATE tasks SET template_uuid = ? WHERE id = ?")
            .run(templateId, row.id);
        }
        const presetConfig = JSON.stringify(normalizeBrowserFormTemplateConfig(undefined));
        for (const name of ["Lynvx 预置模板", "Discuz 论坛骨架"]) {
          this.db.prepare(`INSERT INTO templates(
            id, adapter_id, name, version, config, is_preset, created_at, updated_at
          ) VALUES(?, 'browser_form', ?, 1, ?, 1, ?, ?)`)
            .run(randomUUID(), name, presetConfig, now(), now());
        }
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(5, ?)")
          .run(now());
      })();
    }

    if (version.version < 6) {
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE run_jobs ADD COLUMN retry_number INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE run_jobs ADD COLUMN next_retry_at TEXT;
          ALTER TABLE run_jobs ADD COLUMN failure_class TEXT;
          CREATE TABLE task_notification_policies (
            task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
            notify_manual INTEGER NOT NULL DEFAULT 1,
            notify_scheduled INTEGER NOT NULL DEFAULT 1,
            notify_success INTEGER NOT NULL DEFAULT 1,
            notify_failure INTEGER NOT NULL DEFAULT 1,
            failure_threshold INTEGER NOT NULL DEFAULT 1,
            consecutive_failures INTEGER NOT NULL DEFAULT 0
          );
          CREATE TABLE daily_summary_log (summary_date TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
          INSERT INTO task_notification_policies(task_id) SELECT id FROM tasks;
        `);
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(6, ?)").run(now());
      })();
    }

    if (version.version < 7) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE manual_session_tokens (
            token_hash TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_manual_session_tokens_expires_at
            ON manual_session_tokens(expires_at);
        `);
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(7, ?)").run(now());
      })();
    }

    if (version.version < 8) {
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE system_settings ADD COLUMN proxy_tested_at TEXT;
          ALTER TABLE system_settings ADD COLUMN proxy_test_success INTEGER;
          ALTER TABLE system_settings ADD COLUMN proxy_test_message TEXT;
        `);
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(8, ?)").run(now());
      })();
    }

    if (version.version < 9) {
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE system_settings
            ADD COLUMN screenshot_max_mb INTEGER NOT NULL DEFAULT 500;
        `);
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(9, ?)").run(now());
      })();
    }

    if (version.version < 10) {
      this.db.transaction(() => {
        this.db.exec(`ALTER TABLE templates ADD COLUMN description TEXT NOT NULL DEFAULT '';`);
        this.db.prepare(`UPDATE templates SET name = ?, description = ?
          WHERE is_preset = 1 AND name = ?`).run(
          "通用账号密码网页登录",
          "适合账号或邮箱、密码和登录按钮组成的常见网页；签到入口可继续用文字、元素属性或人工选择补充。",
          "Lynvx 预置模板",
        );
        this.db.prepare(`UPDATE templates SET name = ?, description = ?
          WHERE is_preset = 1 AND name = ?`).run(
          "Discuz 论坛签到骨架",
          "适合 Discuz 论坛登录后通过插件、文字或图片入口签到；具体入口建议用人工元素选择确认。",
          "Discuz 论坛骨架",
        );
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(10, ?)").run(now());
      })();
    }

    if (version.version < 11) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
          ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
            CHECK (role IN ('user', 'admin'));
          ALTER TABLE sessions ADD COLUMN display_name TEXT NOT NULL DEFAULT '管理员';
          CREATE INDEX idx_sessions_user_id ON sessions(user_id);
        `);
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(11, ?)")
          .run(now());
      })();
    }

    if (version.version < 12) {
      this.db.pragma("foreign_keys = OFF");
      try {
        this.db.transaction(() => {
          this.db.exec(`
            ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'suspended'));
            ALTER TABLE users ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '{}';
            ALTER TABLE users ADD COLUMN max_tasks INTEGER NOT NULL DEFAULT 5;
            ALTER TABLE users ADD COLUMN max_enabled_tasks INTEGER NOT NULL DEFAULT 5;
            ALTER TABLE users ADD COLUMN max_daily_actions INTEGER NOT NULL DEFAULT 20;
            ALTER TABLE users ADD COLUMN last_login_at TEXT;
            ALTER TABLE users ADD COLUMN suspended_at TEXT;

            ALTER TABLE tasks ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
            ALTER TABLE templates ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
            ALTER TABLE templates ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE runs ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
            CREATE INDEX idx_tasks_owner_user_id ON tasks(owner_user_id);
            CREATE INDEX idx_templates_owner_user_id ON templates(owner_user_id);
            CREATE INDEX idx_runs_owner_user_id_finished_at ON runs(owner_user_id, finished_at DESC);

            ALTER TABLE system_settings ADD COLUMN registration_mode TEXT NOT NULL DEFAULT 'invite'
              CHECK (registration_mode IN ('closed', 'invite', 'public'));
            ALTER TABLE system_settings ADD COLUMN audit_retention_days INTEGER NOT NULL DEFAULT 180;
            ALTER TABLE system_settings ADD COLUMN default_user_capabilities_json TEXT NOT NULL
              DEFAULT '{"scheduleTasks":true,"runTasksManually":true,"useManualLogin":true,"importHar":true,"useHttpFlow":false,"useCustomProxy":false,"submitSharedTemplates":true}';
            ALTER TABLE system_settings ADD COLUMN default_max_tasks INTEGER NOT NULL DEFAULT 5;
            ALTER TABLE system_settings ADD COLUMN default_max_enabled_tasks INTEGER NOT NULL DEFAULT 5;
            ALTER TABLE system_settings ADD COLUMN default_max_daily_actions INTEGER NOT NULL DEFAULT 20;
            ALTER TABLE run_jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;

            ALTER TABLE notification_channels RENAME TO notification_channels_v11;
            CREATE TABLE notification_channels (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
              channel TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 0,
              secret_cipher TEXT,
              updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX idx_notification_channels_owner
              ON notification_channels(owner_user_id, channel) WHERE owner_user_id IS NOT NULL;
            CREATE UNIQUE INDEX idx_notification_channels_primary_owner
              ON notification_channels(channel) WHERE owner_user_id IS NULL;
            INSERT INTO notification_channels(id, owner_user_id, channel, enabled, secret_cipher, updated_at)
              SELECT 'owner:' || channel, NULL, channel, enabled, secret_cipher, updated_at
              FROM notification_channels_v11;
            DROP TABLE notification_channels_v11;

            ALTER TABLE notification_templates RENAME TO notification_templates_v11;
            CREATE TABLE notification_templates (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
              channel TEXT NOT NULL,
              status TEXT NOT NULL,
              content TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX idx_notification_templates_owner
              ON notification_templates(owner_user_id, channel, status) WHERE owner_user_id IS NOT NULL;
            CREATE UNIQUE INDEX idx_notification_templates_primary_owner
              ON notification_templates(channel, status) WHERE owner_user_id IS NULL;
            INSERT INTO notification_templates(id, owner_user_id, channel, status, content, updated_at)
              SELECT 'owner:' || channel || ':' || status, NULL, channel, status, content, updated_at
              FROM notification_templates_v11;
            DROP TABLE notification_templates_v11;

            ALTER TABLE daily_summary_log RENAME TO daily_summary_log_v11;
            CREATE TABLE daily_summary_log (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
              summary_date TEXT NOT NULL,
              sent_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX idx_daily_summary_owner
              ON daily_summary_log(owner_user_id, summary_date) WHERE owner_user_id IS NOT NULL;
            CREATE UNIQUE INDEX idx_daily_summary_primary_owner
              ON daily_summary_log(summary_date) WHERE owner_user_id IS NULL;
            INSERT INTO daily_summary_log(id, owner_user_id, summary_date, sent_at)
              SELECT 'owner:' || summary_date, NULL, summary_date, sent_at FROM daily_summary_log_v11;
            DROP TABLE daily_summary_log_v11;

            CREATE TABLE registration_invites (
              id TEXT PRIMARY KEY,
              code_hash TEXT NOT NULL UNIQUE,
              label TEXT NOT NULL DEFAULT '',
              max_uses INTEGER NOT NULL DEFAULT 1,
              used_count INTEGER NOT NULL DEFAULT 0,
              expires_at TEXT,
              disabled_at TEXT,
              created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE password_reset_tokens (
              token_hash TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              expires_at TEXT NOT NULL,
              used_at TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX idx_password_reset_expires_at ON password_reset_tokens(expires_at);
            CREATE TABLE usage_counters (
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              usage_date TEXT NOT NULL,
              action_count INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY(user_id, usage_date)
            );
            CREATE TABLE template_submissions (
              id TEXT PRIMARY KEY,
              source_template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
              submitter_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
              submitter_name TEXT NOT NULL,
              name TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT '',
              config_snapshot TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
              review_note TEXT,
              reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
              reviewer_name TEXT,
              published_template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
              created_at TEXT NOT NULL,
              reviewed_at TEXT
            );
            CREATE INDEX idx_template_submissions_status_created
              ON template_submissions(status, created_at DESC);
            CREATE TABLE audit_events (
              id TEXT PRIMARY KEY,
              actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
              actor_role TEXT NOT NULL CHECK (actor_role IN ('user', 'admin')),
              actor_owner INTEGER NOT NULL DEFAULT 0,
              actor_display_name TEXT NOT NULL,
              action TEXT NOT NULL,
              target_type TEXT NOT NULL,
              target_id TEXT,
              target_label TEXT,
              result TEXT NOT NULL CHECK (result IN ('success', 'denied', 'failure')),
              metadata_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );
            CREATE INDEX idx_audit_events_created_at ON audit_events(created_at DESC);
            CREATE INDEX idx_audit_events_actor ON audit_events(actor_user_id, created_at DESC);
          `);
          this.db.prepare("UPDATE users SET capabilities_json = ? WHERE capabilities_json = '{}'")
            .run(JSON.stringify(defaultUserCapabilities));
          this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(12, ?)")
            .run(now());
        })();
      } finally {
        this.db.pragma("foreign_keys = ON");
      }
    }
  }

  private seed(seedSampleData: boolean): void {
    const timestamp = now();
    this.db
      .prepare(`INSERT OR IGNORE INTO system_settings(
        id, retry_count, retry_delay_ms, navigation_timeout_ms,
        action_timeout_ms, retention_days, proxy_server, session_hours, updated_at
      ) VALUES(1, 2, 10000, 60000, 20000, 30, '', 12, ?)`)
      .run(timestamp);
    if (seedSampleData) {
      this.db.prepare("UPDATE system_settings SET registration_mode = 'public' WHERE id = 1")
        .run();
    }

    for (const channel of ["serverchan", "wechat", "bark", "telegram", "webhook"] as NotificationChannel[]) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO notification_channels(
            id, owner_user_id, channel, enabled, updated_at
          ) VALUES(?, NULL, ?, 0, ?)`,
        )
        .run(`owner:${channel}`, channel, timestamp);
      for (const status of [
        "success",
        "already_checked",
        "failure",
      ] as TemplateStatus[]) {
        this.db
          .prepare(`INSERT OR IGNORE INTO notification_templates(
            id, owner_user_id, channel, status, content, updated_at
          ) VALUES(?, NULL, ?, ?, ?, ?)`)
          .run(`owner:${channel}:${status}`, channel, status, defaultTemplates[status], timestamp);
      }
    }
    const existingUsers = this.db.prepare("SELECT id FROM users").all() as Array<{ id: string }>;
    for (const user of existingUsers) this.ensureNotificationDefaults(user.id);

    if (!seedSampleData) return;
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as {
      count: number;
    };
    if (count.count > 0) return;

    const sampleTask: TaskInput = {
      templateId: "browser_form",
      templateConfig: normalizeBrowserFormTemplateConfig({
        version: 1,
        checkinButtonSelector: ".claim-button",
      }),
      name: "通用网页登录",
      loginUrl: "https://example.com/#/login",
      checkinUrl: "https://example.com/#/checkin",
      username: "sample@example.com",
      password: "sample-password",
      scheduleTime: "08:00",
      timezone: "Asia/Shanghai",
      notifyServerChan: true,
      notifyWechat: false,
      enabled: true,
    };
    const task = this.createTask(sampleTask);
    const seedRuns: Array<[RunStatus, string, number]> = [
      ["already_checked", "模拟结果：今日已签到，未访问目标网站", 12],
      ["success", "模拟结果：签到成功，未访问目标网站", 35],
      ["already_checked", "模拟结果：今日已签到，未访问目标网站", 1_440],
      ["failure", "模拟网络请求失败，状态码 500", 1_475],
    ];
    for (const [status, message, minutesAgo] of seedRuns) {
      const finishedAt = new Date(Date.now() - minutesAgo * 60_000);
      const startedAt = new Date(finishedAt.getTime() - 1_230);
      this.insertRun({
        id: randomUUID(),
        taskId: task.id,
        taskName: task.name,
        trigger: minutesAgo % 2 === 0 ? "scheduled" : "manual",
        status,
        message,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: 1_230,
        attempt: 1,
        notificationResult: "simulated",
      });
    }

  }

  isSetup(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM admin_credentials WHERE id = 1").get());
  }

  getSettings(): SystemSettings {
    const row = this.db.prepare("SELECT * FROM system_settings WHERE id = 1").get() as {
      retry_count: number;
      retry_delay_ms: number;
      navigation_timeout_ms: number;
      action_timeout_ms: number;
      retention_days: number;
      screenshot_max_mb: number;
      proxy_server: string;
      session_hours: number;
      registration_mode: "closed" | "invite" | "public";
      audit_retention_days: number;
    };
    return {
      retryCount: row.retry_count,
      retryDelayMs: row.retry_delay_ms,
      navigationTimeoutMs: row.navigation_timeout_ms,
      actionTimeoutMs: row.action_timeout_ms,
      retentionDays: row.retention_days,
      screenshotMaxMb: row.screenshot_max_mb,
      proxyServer: row.proxy_server,
      sessionHours: row.session_hours,
      registrationMode: row.registration_mode,
      auditRetentionDays: row.audit_retention_days,
    };
  }

  ensureNotificationDefaults(ownerUserId: string | null): void {
    const timestamp = now();
    const ownerKey = ownerUserId || "owner";
    for (const channel of ["serverchan", "wechat", "bark", "telegram", "webhook"] as NotificationChannel[]) {
      this.db.prepare(`INSERT OR IGNORE INTO notification_channels(
        id, owner_user_id, channel, enabled, updated_at
      ) VALUES(?, ?, ?, 0, ?)`).run(`${ownerKey}:${channel}`, ownerUserId, channel, timestamp);
      for (const status of ["success", "already_checked", "failure"] as TemplateStatus[]) {
        this.db.prepare(`INSERT OR IGNORE INTO notification_templates(
          id, owner_user_id, channel, status, content, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?)`).run(
          `${ownerKey}:${channel}:${status}`,
          ownerUserId,
          channel,
          status,
          defaultTemplates[status],
          timestamp,
        );
      }
    }
  }

  listTasks(): TaskSummary[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks ORDER BY created_at ASC")
      .all() as TaskRow[];
    const latest = this.db.prepare(
      "SELECT * FROM runs WHERE task_id = ? ORDER BY finished_at DESC LIMIT 1",
    );
    const templateConfig = this.db.prepare("SELECT adapter_id, config FROM templates WHERE id = ?");
    return rows.map((row) => {
      const latestRow = latest.get(row.id) as RunRow | undefined;
      const linked = row.template_uuid
        ? templateConfig.get(row.template_uuid) as { adapter_id: "browser_form" | "http_flow"; config: string } | undefined
        : undefined;
      const notificationPolicy = this.getNotificationPolicy(row.id);
      const next = nextRunInfo(row.schedule_time, row.timezone, Boolean(row.enabled));
      return {
        id: row.id,
        ownerUserId: row.owner_user_id || undefined,
        templateId: linked?.adapter_id || row.adapter_id,
        adapterId: linked?.adapter_id || row.adapter_id,
        templateUuid: row.template_uuid || undefined,
        templateConfig: templateConfigFromRow(row),
        httpFlowConfig: linked?.adapter_id === "http_flow"
          ? JSON.parse(linked.config) : undefined,
        name: row.name,
        loginUrl: row.login_url,
        checkinUrl: row.checkin_url,
        usernameMasked: row.username_masked,
        hasPassword: Boolean(row.password_cipher),
        scheduleTime: row.schedule_time,
        timezone: row.timezone,
        notifyServerChan: Boolean(row.notify_serverchan),
        notifyWechat: Boolean(row.notify_wechat),
        enabled: Boolean(row.enabled),
        proxyMode: row.proxy_mode,
        proxyServer: row.proxy_server,
        proxyUsernameMasked: row.proxy_username_cipher
          ? maskUsername(decryptSecret(row.proxy_username_cipher, this.key))
          : undefined,
        hasProxyPassword: Boolean(row.proxy_password_cipher),
        notificationPolicy,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        latestRun: latestRow ? runFromRow(latestRow) : undefined,
        ...next,
      };
    });
  }

  listTasksByOwner(ownerUserId: string | null): TaskSummary[] {
    return this.listTasks().filter((task) => (task.ownerUserId || null) === ownerUserId);
  }

  getTaskForOwner(id: string, ownerUserId: string | null): TaskSummary | undefined {
    const task = this.getTask(id);
    return task && (task.ownerUserId || null) === ownerUserId ? task : undefined;
  }

  getTask(id: string): TaskSummary | undefined {
    return this.listTasks().find((task) => task.id === id);
  }

  getTaskSecrets(id: string): { username: string; password: string } | undefined {
    const row = this.db
      .prepare("SELECT username_cipher, password_cipher FROM tasks WHERE id = ?")
      .get(id) as
      | { username_cipher: string; password_cipher: string }
      | undefined;
    if (!row) return undefined;
    return {
      username: decryptSecret(row.username_cipher, this.key),
      password: decryptSecret(row.password_cipher, this.key),
    };
  }

  createTask(input: TaskInput, ownerUserId: string | null = null): TaskSummary {
    if (!input.username || !input.password) {
      throw new Error("新任务必须填写登录用户名和密码");
    }
    const timestamp = now();
    const id = randomUUID();
    let templateUuid = input.templateUuid;
    let effectiveAdapter: "browser_form" | "http_flow" = "browser_form";
    let effectiveConfig = normalizeBrowserFormTemplateConfig(input.templateConfig);
    if (templateUuid) {
      const selected = this.db.prepare("SELECT adapter_id, config, tested_at, is_preset, is_shared, name FROM templates WHERE id = ?")
        .get(templateUuid) as { adapter_id: "browser_form" | "http_flow"; config: string; tested_at: string | null; is_preset: number; is_shared: number; name: string } | undefined;
      if (!selected) throw new Error("执行模板不存在");
      effectiveAdapter = selected.adapter_id;
      if (effectiveAdapter === "http_flow" && !selected.tested_at) {
        throw new Error("HTTP 流程模板必须先测试通过才能创建任务");
      }
      if (effectiveAdapter === "browser_form") effectiveConfig = normalizeBrowserFormTemplateConfig(JSON.parse(selected.config));
      if (selected.is_preset || selected.is_shared) {
        const privateTemplateId = randomUUID();
        this.db.prepare(`INSERT INTO templates(
          id, owner_user_id, adapter_id, name, description, version, config, is_private, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`).run(
          privateTemplateId,
          ownerUserId,
          selected.adapter_id,
          `${input.name} · 任务专用`,
          `由预置模板“${selected.name}”在创建任务时自动生成。`,
          selected.config,
          timestamp,
          timestamp,
        );
        templateUuid = privateTemplateId;
      }
    } else {
      templateUuid = randomUUID();
      this.db.prepare(`INSERT INTO templates(
        id, owner_user_id, adapter_id, name, version, config, is_private, created_at, updated_at
      ) VALUES(?, ?, 'browser_form', ?, 1, ?, 1, ?, ?)`)
        .run(templateUuid, ownerUserId, `${input.name} 私有模板`, JSON.stringify(effectiveConfig), timestamp, timestamp);
    }
    this.db
      .prepare(`INSERT INTO tasks(
        id, owner_user_id, adapter_id, template_config, template_uuid, name, login_url, checkin_url,
        username_cipher, password_cipher, username_masked,
        schedule_time, timezone, notify_serverchan, notify_wechat,
        enabled, proxy_mode, proxy_server, proxy_username_cipher,
        proxy_password_cipher, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        ownerUserId,
        effectiveAdapter,
        JSON.stringify(effectiveConfig),
        templateUuid,
        input.name,
        input.loginUrl,
        input.checkinUrl,
        encryptSecret(input.username, this.key),
        encryptSecret(input.password, this.key),
        maskUsername(input.username),
        input.scheduleTime,
        input.timezone,
        Number(input.notifyServerChan),
        Number(input.notifyWechat),
        Number(input.enabled),
        input.proxyMode || "inherit",
        input.proxyServer || "",
        input.proxyUsername ? encryptSecret(input.proxyUsername, this.key) : null,
        input.proxyPassword ? encryptSecret(input.proxyPassword, this.key) : null,
        timestamp,
        timestamp,
      );
    this.saveNotificationPolicy(id, input.notificationPolicy);
    return this.getTask(id)!;
  }

  updateTask(id: string, input: TaskInput): TaskSummary | undefined {
    const existing = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | TaskRow
      | undefined;
    if (!existing) return undefined;
    let templateUuid = input.templateUuid || existing.template_uuid;
    const selectedTemplate = templateUuid
      ? this.db.prepare("SELECT adapter_id, config, tested_at, is_preset, is_shared, name FROM templates WHERE id = ?").get(templateUuid) as { adapter_id: "browser_form" | "http_flow"; config: string; tested_at: string | null; is_preset: number; is_shared: number; name: string } | undefined
      : undefined;
    if (templateUuid && !selectedTemplate) throw new Error("执行模板不存在");
    if (selectedTemplate?.adapter_id === "http_flow" && !selectedTemplate.tested_at) {
      throw new Error("HTTP 流程模板必须先测试通过才能用于任务");
    }
    if (selectedTemplate?.is_preset || selectedTemplate?.is_shared) {
      const privateTemplateId = randomUUID();
      const timestamp = now();
      this.db.prepare(`INSERT INTO templates(
        id, owner_user_id, adapter_id, name, description, version, config, is_private, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`).run(
        privateTemplateId,
        existing.owner_user_id,
        selectedTemplate.adapter_id,
        `${input.name} · 任务专用`,
        `由预置模板“${selectedTemplate.name}”在保存任务时自动生成。`,
        selectedTemplate.config,
        timestamp,
        timestamp,
      );
      templateUuid = privateTemplateId;
    }
    const effectiveConfig = selectedTemplate?.adapter_id === "browser_form"
      ? templateUuid !== existing.template_uuid
        ? normalizeBrowserFormTemplateConfig(JSON.parse(selectedTemplate.config))
        : normalizeBrowserFormTemplateConfig(input.templateConfig)
      : normalizeBrowserFormTemplateConfig(input.templateConfig);
    const usernameCipher = input.username
      ? encryptSecret(input.username, this.key)
      : existing.username_cipher;
    const passwordCipher = input.password
      ? encryptSecret(input.password, this.key)
      : existing.password_cipher;
    const usernameMasked = input.username
      ? maskUsername(input.username)
      : existing.username_masked;
    const proxyUsernameCipher = input.proxyUsername
      ? encryptSecret(input.proxyUsername, this.key)
      : existing.proxy_username_cipher;
    const proxyPasswordCipher = input.proxyPassword
      ? encryptSecret(input.proxyPassword, this.key)
      : existing.proxy_password_cipher;
    this.db
      .prepare(`UPDATE tasks SET
        adapter_id = ?, template_config = ?, template_uuid = ?, name = ?, login_url = ?, checkin_url = ?,
        username_cipher = ?, password_cipher = ?, username_masked = ?,
        schedule_time = ?, timezone = ?, notify_serverchan = ?,
        notify_wechat = ?, enabled = ?, proxy_mode = ?, proxy_server = ?,
        proxy_username_cipher = ?, proxy_password_cipher = ?, updated_at = ? WHERE id = ?`)
      .run(
        selectedTemplate?.adapter_id || input.templateId,
        JSON.stringify(effectiveConfig),
        templateUuid,
        input.name,
        input.loginUrl,
        input.checkinUrl,
        usernameCipher,
        passwordCipher,
        usernameMasked,
        input.scheduleTime,
        input.timezone,
        Number(input.notifyServerChan),
        Number(input.notifyWechat),
        Number(input.enabled),
        input.proxyMode || "inherit",
        input.proxyServer || "",
        proxyUsernameCipher,
        proxyPasswordCipher,
        now(),
        id,
      );
    this.saveNotificationPolicy(id, input.notificationPolicy);
    if (templateUuid !== existing.template_uuid && existing.template_uuid) {
      this.deleteOrphanPrivateTemplate(existing.template_uuid);
    }
    return this.getTask(id);
  }

  deleteTask(id: string): boolean {
    const row = this.db.prepare("SELECT template_uuid FROM tasks WHERE id = ?").get(id) as
      { template_uuid: string | null } | undefined;
    if (!row) return false;
    const deleted = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes > 0;
    if (deleted && row.template_uuid) this.deleteOrphanPrivateTemplate(row.template_uuid);
    return deleted;
  }

  private deleteOrphanPrivateTemplate(templateId: string): void {
    this.db.prepare(`DELETE FROM templates WHERE id = ? AND is_private = 1
      AND NOT EXISTS(SELECT 1 FROM tasks WHERE template_uuid = ?)`).run(templateId, templateId);
  }

  setTaskCheckinSelector(id: string, selector: string): TaskSummary | undefined {
    const row = this.db.prepare("SELECT adapter_id, template_config FROM tasks WHERE id = ?")
      .get(id) as Pick<TaskRow, "adapter_id" | "template_config"> | undefined;
    if (!row) return undefined;
    if (row.adapter_id !== "browser_form") throw new Error("只有网页登录任务可以选择签到元素");
    const config = normalizeBrowserFormTemplateConfig(JSON.parse(row.template_config));
    config.checkinButtonSelector = selector;
    this.db.prepare("UPDATE tasks SET template_config = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(config), now(), id);
    return this.getTask(id);
  }

  getNotificationPolicy(taskId: string) {
    const row = this.db.prepare("SELECT * FROM task_notification_policies WHERE task_id = ?")
      .get(taskId) as any;
    return {
      manual: Boolean(row?.notify_manual ?? 1),
      scheduled: Boolean(row?.notify_scheduled ?? 1),
      success: Boolean(row?.notify_success ?? 1),
      failure: Boolean(row?.notify_failure ?? 1),
      failureThreshold: row?.failure_threshold || 1,
      consecutiveFailures: row?.consecutive_failures || 0,
    };
  }

  saveNotificationPolicy(taskId: string, policy?: import("../shared/types.js").TaskNotificationPolicy): void {
    const value = policy || { manual: true, scheduled: true, success: true, failure: true, failureThreshold: 1 };
    this.db.prepare(`INSERT INTO task_notification_policies(
      task_id, notify_manual, notify_scheduled, notify_success, notify_failure, failure_threshold
    ) VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET notify_manual=excluded.notify_manual,
      notify_scheduled=excluded.notify_scheduled, notify_success=excluded.notify_success,
      notify_failure=excluded.notify_failure, failure_threshold=excluded.failure_threshold`)
      .run(taskId, Number(value.manual), Number(value.scheduled), Number(value.success), Number(value.failure), Math.max(1, value.failureThreshold));
  }

  recordTaskOutcome(taskId: string, succeeded: boolean): number {
    this.db.prepare(`UPDATE task_notification_policies SET consecutive_failures =
      CASE WHEN ? THEN 0 ELSE consecutive_failures + 1 END WHERE task_id = ?`)
      .run(Number(succeeded), taskId);
    return this.getNotificationPolicy(taskId).consecutiveFailures;
  }

  getTaskProxy(id: string): {
    mode: "inherit" | "direct" | "custom";
    server?: string;
    username?: string;
    password?: string;
  } | undefined {
    const row = this.db.prepare(`SELECT proxy_mode, proxy_server,
      proxy_username_cipher, proxy_password_cipher FROM tasks WHERE id = ?`)
      .get(id) as Pick<TaskRow, "proxy_mode" | "proxy_server" |
        "proxy_username_cipher" | "proxy_password_cipher"> | undefined;
    if (!row) return undefined;
    return {
      mode: row.proxy_mode,
      server: row.proxy_server || undefined,
      username: row.proxy_username_cipher
        ? decryptSecret(row.proxy_username_cipher, this.key) : undefined,
      password: row.proxy_password_cipher
        ? decryptSecret(row.proxy_password_cipher, this.key) : undefined,
    };
  }

  insertRun(run: RunRecord, scheduledKey?: string): void {
    this.db
      .prepare(`INSERT INTO runs(
        id, owner_user_id, task_id, task_name, trigger, scheduled_key, status, message,
        started_at, finished_at, duration_ms, attempt, notification_result,
        error_detail, screenshot_path, phase, final_url, detection_signals
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        run.id,
        run.taskId
          ? (this.db.prepare("SELECT owner_user_id FROM tasks WHERE id = ?").get(run.taskId) as { owner_user_id: string | null } | undefined)?.owner_user_id || null
          : run.ownerUserId || null,
        run.taskId || null,
        run.taskName,
        run.trigger,
        scheduledKey || null,
        run.status,
        run.message,
        run.startedAt,
        run.finishedAt,
        run.durationMs,
        run.attempt,
        run.notificationResult,
        run.errorDetail || null,
        run.screenshotPath || null,
        run.phase || "checkin",
        run.finalUrl || null,
        JSON.stringify(run.detectionSignals || []),
      );
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
      | RunRow
      | undefined;
    return row ? runFromRow(row) : undefined;
  }

  getScreenshotPath(id: string): string | undefined {
    const row = this.db
      .prepare("SELECT screenshot_path FROM runs WHERE id = ?")
      .get(id) as { screenshot_path: string | null } | undefined;
    return row?.screenshot_path || undefined;
  }

  cleanupRuns(): number {
    const settings = this.getSettings();
    const cutoff = new Date(Date.now() - settings.retentionDays * 86_400_000).toISOString();
    return this.db.prepare("DELETE FROM runs WHERE finished_at < ?").run(cutoff).changes;
  }
}

export { defaultTemplates, runFromRow };
