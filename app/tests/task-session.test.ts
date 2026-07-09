import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeBrowserFormTemplateConfig } from "../src/shared/browser-form.js";
import { AppDatabase } from "../src/server/database.js";
import {
  TaskSessionRepository,
  type BrowserStorageState,
} from "../src/server/repositories/task-session.js";

describe("TaskSessionRepository", () => {
  let directory: string;
  let database: AppDatabase;
  let sessions: TaskSessionRepository;
  let firstTaskId: string;
  let secondTaskId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "checkin-session-"));
    database = new AppDatabase(path.join(directory, "session.sqlite"), randomBytes(32), false);
    sessions = new TaskSessionRepository(database.db, database.key);
    firstTaskId = createTask("First", "first@example.com");
    secondTaskId = createTask("Second", "second@example.com");
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("encrypts storage state with the task id as AAD", () => {
    const state: BrowserStorageState = {
      cookies: [{
        name: "session",
        value: "sensitive-cookie",
        domain: "example.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      }],
      origins: [],
    };
    sessions.save(firstTaskId, state);
    const row = database.db.prepare(
      "SELECT state_cipher FROM task_sessions WHERE task_id = ?",
    ).get(firstTaskId) as { state_cipher: string };
    expect(row.state_cipher).not.toContain("sensitive-cookie");
    expect(sessions.get(firstTaskId)).toEqual(state);

    database.db.prepare(`INSERT INTO task_sessions(
      task_id, state_cipher, status, created_at, updated_at
    ) VALUES(?, ?, 'valid', ?, ?)`).run(
      secondTaskId,
      row.state_cipher,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    expect(() => sessions.get(secondTaskId)).toThrow();
  });

  it("exposes only status metadata and supports expiry and clearing", () => {
    expect(sessions.getStatus(firstTaskId)).toEqual({ status: "none" });
    sessions.save(firstTaskId, { cookies: [], origins: [] });
    expect(sessions.getStatus(firstTaskId)).toMatchObject({ status: "valid" });
    expect(sessions.markExpired(firstTaskId)).toMatchObject({ status: "expired" });
    expect(sessions.clear(firstTaskId)).toBe(true);
    expect(sessions.getStatus(firstTaskId)).toEqual({ status: "none" });
  });

  function createTask(name: string, username: string): string {
    return database.createTask({
      templateId: "browser_form",
      templateConfig: normalizeBrowserFormTemplateConfig(undefined),
      name,
      loginUrl: "https://example.com/login",
      checkinUrl: "https://example.com/checkin",
      username,
      password: "password",
      scheduleTime: "08:00",
      timezone: "Asia/Shanghai",
      notifyServerChan: false,
      notifyWechat: false,
      enabled: true,
    }).id;
  }
});
