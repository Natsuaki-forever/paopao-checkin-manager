import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeBrowserFormTemplateConfig } from "../src/shared/browser-form.js";
import { AppDatabase } from "../src/server/database.js";
import { testProxyTarget } from "../src/server/routes/settings.js";

describe("per-task proxy", () => {
  let directory = "";
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("encrypts custom credentials and returns only masked metadata", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "checkin-proxy-"));
    const database = new AppDatabase(path.join(directory, "proxy.sqlite"), randomBytes(32), false);
    const task = database.createTask({
      templateId: "browser_form",
      templateConfig: normalizeBrowserFormTemplateConfig(undefined),
      name: "Proxy task",
      loginUrl: "https://example.com/login",
      checkinUrl: "https://example.com/checkin",
      username: "user@example.com",
      password: "task-password",
      scheduleTime: "08:00",
      timezone: "Asia/Shanghai",
      notifyServerChan: false,
      notifyWechat: false,
      enabled: true,
      proxyMode: "custom",
      proxyServer: "http://proxy.example.com:8080",
      proxyUsername: "proxy-user",
      proxyPassword: "proxy-password",
    });
    expect(task).toMatchObject({
      proxyMode: "custom",
      proxyServer: "http://proxy.example.com:8080",
      proxyUsernameMasked: "pr***",
      hasProxyPassword: true,
    });
    expect(JSON.stringify(task)).not.toContain("proxy-password");
    expect(database.getTaskProxy(task.id)).toEqual({
      mode: "custom",
      server: "http://proxy.example.com:8080",
      username: "proxy-user",
      password: "proxy-password",
    });
    const stored = database.db.prepare(`SELECT proxy_username_cipher, proxy_password_cipher
      FROM tasks WHERE id = ?`).get(task.id) as Record<string, string>;
    expect(JSON.stringify(stored)).not.toContain("proxy-user");
    expect(JSON.stringify(stored)).not.toContain("proxy-password");
    database.saveNotificationPolicy(task.id, {
      manual: true, scheduled: false, success: false, failure: true, failureThreshold: 2,
    });
    expect(database.recordTaskOutcome(task.id, false)).toBe(1);
    expect(database.recordTaskOutcome(task.id, false)).toBe(2);
    expect(database.recordTaskOutcome(task.id, true)).toBe(0);
    database.close();
  });

  it("tests a CONNECT tunnel to the target rather than only opening the proxy port", async () => {
    let request = "";
    const server = net.createServer((socket) => {
      socket.once("data", (chunk) => {
        request = chunk.toString("latin1");
        socket.end("HTTP/1.1 200 Connection Established\r\n\r\n");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as net.AddressInfo;
    await testProxyTarget(
      `http://127.0.0.1:${address.port}`,
      "https://93.184.216.34/checkin",
    );
    expect(request).toContain("CONNECT 93.184.216.34:443 HTTP/1.1");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
