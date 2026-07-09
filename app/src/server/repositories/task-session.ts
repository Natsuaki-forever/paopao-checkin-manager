import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { TaskSessionStatus } from "../../shared/types.js";
import { decryptSecret, encryptSecret } from "../crypto.js";

export interface BrowserStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

interface SessionRow {
  state_cipher: string;
  status: "valid" | "expired";
  updated_at: string;
}

export class TaskSessionRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly key: Buffer,
  ) {}

  getStatus(taskId: string): TaskSessionStatus {
    const row = this.db.prepare(
      "SELECT status, updated_at FROM task_sessions WHERE task_id = ?",
    ).get(taskId) as Pick<SessionRow, "status" | "updated_at"> | undefined;
    return row
      ? { status: row.status, updatedAt: row.updated_at }
      : { status: "none" };
  }

  get(taskId: string): BrowserStorageState | undefined {
    const row = this.db.prepare(
      "SELECT state_cipher, status, updated_at FROM task_sessions WHERE task_id = ?",
    ).get(taskId) as SessionRow | undefined;
    if (!row) return undefined;
    const parsed = JSON.parse(decryptSecret(row.state_cipher, this.key, taskId)) as unknown;
    return validateStorageState(parsed);
  }

  save(taskId: string, state: BrowserStorageState): TaskSessionStatus {
    const validated = validateStorageState(state);
    const timestamp = new Date().toISOString();
    const cipher = encryptSecret(JSON.stringify(validated), this.key, taskId);
    this.db.prepare(`INSERT INTO task_sessions(
      task_id, state_cipher, status, created_at, updated_at
    ) VALUES(?, ?, 'valid', ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      state_cipher = excluded.state_cipher,
      status = 'valid',
      updated_at = excluded.updated_at`).run(taskId, cipher, timestamp, timestamp);
    return this.getStatus(taskId);
  }

  markExpired(taskId: string): TaskSessionStatus {
    this.db.prepare(`UPDATE task_sessions SET status = 'expired', updated_at = ?
      WHERE task_id = ?`).run(new Date().toISOString(), taskId);
    return this.getStatus(taskId);
  }

  clear(taskId: string): boolean {
    return this.db.prepare("DELETE FROM task_sessions WHERE task_id = ?")
      .run(taskId).changes > 0;
  }

  issueManualToken(taskId: string, lifetimeMs = 10 * 60_000): {
    token: string;
    expiresAt: string;
  } {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM manual_session_tokens WHERE expires_at <= ? OR used_at IS NOT NULL")
        .run(createdAt);
      this.db.prepare(`INSERT INTO manual_session_tokens(
        token_hash, task_id, expires_at, created_at
      ) VALUES(?, ?, ?, ?)`).run(tokenHash, taskId, expiresAt, createdAt);
    })();
    return { token, expiresAt };
  }

  consumeManualToken(token: string): string | undefined {
    const row = this.db.prepare(`UPDATE manual_session_tokens
      SET used_at = ?
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
      RETURNING task_id`).get(
      new Date().toISOString(),
      hashToken(token),
      new Date().toISOString(),
    ) as { task_id: string } | undefined;
    return row?.task_id;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function validateStorageState(value: unknown): BrowserStorageState {
  if (!value || typeof value !== "object") throw new Error("浏览器会话格式无效");
  const state = value as Partial<BrowserStorageState>;
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error("浏览器会话格式无效");
  }
  for (const cookie of state.cookies) {
    if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string" ||
      typeof cookie.domain !== "string" || typeof cookie.path !== "string") {
      throw new Error("浏览器 Cookie 格式无效");
    }
  }
  return state as BrowserStorageState;
}
