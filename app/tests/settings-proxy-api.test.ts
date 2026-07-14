import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import type { AppConfig } from "../src/server/config.js";
import { AppDatabase } from "../src/server/database.js";
import { NotificationService } from "../src/server/services/notifier.js";
import { CheckinRunEngine } from "../src/server/services/run-engine.js";

describe("proxy status API", () => {
  let directory = "";
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("persists a successful test and invalidates it when the address changes", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "checkin-proxy-status-"));
    const config: AppConfig = {
      host: "127.0.0.1", port: 8787, dataDir: directory,
      databasePath: path.join(directory, "status.sqlite"),
      secretPath: path.join(directory, "secret.key"), isProduction: false,
      webRoot: path.join(directory, "web"), mode: "production",
      screenshotDir: path.join(directory, "screenshots"),
      legacyModulePath: path.join(directory, "unused.js"),
      features: { queue: false, session: false, httpFlow: false },
    };
    const database = new AppDatabase(config.databasePath, randomBytes(32), false);
    database.createTask({
      name: "Proxy target", templateId: "browser_form",
      loginUrl: "https://93.184.216.34/login",
      checkinUrl: "https://93.184.216.34/checkin",
      username: "user@example.com", password: "secret",
      scheduleTime: "08:00", timezone: "Asia/Shanghai",
      notifyServerChan: false, notifyWechat: false, enabled: true,
    });
    const notifier = new NotificationService(database, true);
    const app = await buildApp(config, database, new CheckinRunEngine(database, "simulation", undefined, notifier), notifier);
    const server = net.createServer((socket) => socket.once("data", () => socket.end("HTTP/1.1 200 Connection Established\r\n\r\n")));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: "a-secure-demo-password" } });
      const cookie = setup.cookies[0]!;
      const headers = { cookie: `${cookie.name}=${cookie.value}` };
      const current = (await app.inject({ method: "GET", url: "/api/settings", headers })).json();
      await app.inject({ method: "PUT", url: "/api/settings", headers, payload: { ...current, proxyServer: `http://127.0.0.1:${port}` } });
      expect((await app.inject({ method: "GET", url: "/api/settings/status", headers })).json()).toMatchObject({ proxy: "configured_not_tested" });

      const tested = await app.inject({ method: "POST", url: "/api/settings/proxy/test", headers });
      expect(tested.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/settings/status", headers })).json()).toMatchObject({
        proxy: "configured_tested",
        proxyTestMessage: "代理已成功连接目标签到站点",
        proxyTestedAt: expect.any(String),
      });

      await app.inject({ method: "PUT", url: "/api/settings", headers, payload: { ...current, proxyServer: "http://127.0.0.1:9999" } });
      expect((await app.inject({ method: "GET", url: "/api/settings/status", headers })).json()).toMatchObject({ proxy: "configured_not_tested" });
    } finally {
      await app.close();
      database.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
