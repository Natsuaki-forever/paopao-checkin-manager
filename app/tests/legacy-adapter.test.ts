import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SystemSettings, TaskSummary } from "../src/shared/types.js";
import { LegacyLynvxAdapter } from "../src/server/adapters/lynvx-legacy.js";

describe("legacy Lynvx adapter", () => {
  let directory = "";

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("maps database task values into the verified adapter contract", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "lynvx-adapter-"));
    const modulePath = path.join(directory, "checkin.mjs");
    await writeFile(
      modulePath,
      `export async function performCheckin(config, attempt) {
        return {
          status: "success",
          message: config.email + "|" + config.proxyServer + "|" + config.usernameSelector + "|" + config.checkinButtonSelectors[0],
          startedAt: "2026-06-30T00:00:00.000Z",
          finishedAt: "2026-06-30T00:00:01.000Z",
          attempt
        };
      }`,
      "utf8",
    );
    const task = {
      id: "task-id",
      templateId: "browser_form",
      templateConfig: {
        version: 1,
        usernameSelector: '#account',
        checkinButtonSelector: '#checkin',
      },
      name: "Lynvx",
      loginUrl: "https://example.com/#/login",
      checkinUrl: "https://example.com/#/checkin",
      usernameMasked: "u***@example.com",
      hasPassword: true,
      scheduleTime: "08:00",
      timezone: "Asia/Shanghai",
      notifyServerChan: true,
      notifyWechat: false,
      enabled: true,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
      proxyMode: "inherit",
      proxyServer: "",
      hasProxyPassword: false,
      nextRun: "明天 08:00",
    } satisfies TaskSummary;
    const settings = {
      retryCount: 2,
      retryDelayMs: 10_000,
      navigationTimeoutMs: 60_000,
      actionTimeoutMs: 20_000,
      retentionDays: 30,
      screenshotMaxMb: 500,
      proxyServer: "http://mihomo:7890",
      sessionHours: 12,
      registrationMode: "invite",
      auditRetentionDays: 180,
    } satisfies SystemSettings;
    const adapter = new LegacyLynvxAdapter(modulePath, directory);
    const result = await adapter.run(
      task,
      { username: "user@example.com", password: "secret" },
      settings,
      1,
      undefined,
      undefined,
      { server: settings.proxyServer },
    );
    expect(result).toMatchObject({
      status: "success",
      message: "user@example.com|http://mihomo:7890|#account|#checkin",
      attempt: 1,
    });
  });
});
