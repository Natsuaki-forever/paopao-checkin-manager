import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium } from "playwright";
import { performCheckin } from "../src/checkin.js";
import { findCheckinButton } from "../src/detection.js";
import { PageChangedError } from "../src/errors.js";
import type { AppConfig } from "../src/types.js";

describe("browser form template", () => {
  let baseUrl = "";
  let directory = "";
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/slow-login") {
      response.end([
        "<!doctype html><html><body>",
        '<form id="login-form" onsubmit="return false">',
        '<input name="username" type="text">',
        '<input name="password" type="password">',
        '<button onclick="history.pushState({}, \'\', \'/dashboard\'); document.getElementById(\'dashboard\').hidden = false; setTimeout(() => document.getElementById(\'login-form\').remove(), 8000)">Sign in</button>',
        "</form>",
        '<main id="dashboard" hidden>Dashboard is loading</main>',
        "</body></html>",
      ].join(""));
      return;
    }    if (request.url === "/login") {
      response.end([
        "<!doctype html><html><body>",
        '<input name="username" type="text">',
        '<input name="password" type="password">',
        '<button onclick="location.href=\'/checkin\'">Sign in</button>',
        "</body></html>",
      ].join(""));
      return;
    }
    if (request.url === "/protected") {
      if (!request.headers.cookie?.includes("auth=1")) {
        response.statusCode = 302;
        response.setHeader("location", "/session-login");
        response.end();
        return;
      }
      response.end('<button id="daily" onclick="document.body.innerHTML=\'<p>Claimed</p>\'">Claim</button>');
      return;
    }
    if (request.url === "/session-login") {
      response.end([
        "<!doctype html><html><body>",
        '<input name="username" type="text">',
        '<input name="password" type="password">',
        '<button onclick="document.cookie=\'auth=1; path=/\'; location.href=\'/protected\'">Sign in</button>',
        "</body></html>",
      ].join(""));
      return;
    }
    if (request.url === "/checkin") {
      response.end([
        "<!doctype html><html><body>",
        '<button id="daily" onclick="document.body.innerHTML=\'<p>Claimed</p>\'">Claim</button>',
        "</body></html>",
      ].join(""));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "browser-form-"));
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = "http://127.0.0.1:" + address.port;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await rm(directory, { recursive: true, force: true });
  });

  it("logs in and completes a generic English check-in flow", async () => {
    const config: AppConfig = {
      targetUrl: baseUrl + "/checkin",
      loginUrl: baseUrl + "/login",
      timezone: "Asia/Shanghai",
      cronExpression: "0 0 8 * * *",
      headless: true,
      email: "fixture-user",
      password: "fixture-password",
      navigationTimeoutMs: 10_000,
      actionTimeoutMs: 5_000,
      retryCount: 0,
      retryDelayMs: 0,
      logPath: path.join(directory, "run.jsonl"),
      screenshotDir: directory,
      lockPath: path.join(directory, "run.lock"),
      loginButtonTexts: ["Sign in"],
      checkinButtonSelectors: [],
      successSelectors: [],
      alreadyCheckedSelectors: [],
      challengeSelectors: [".captcha"],
      checkinButtonTexts: ["Claim"],
      successTexts: ["Claimed"],
      alreadyCheckedTexts: ["Already claimed"],
      challengeTexts: ["Captcha"],
    };
    const result = await performCheckin(config, 1);
    assert.equal(result.status, "success");
    assert.ok(result.storageState);

    const phases: string[] = [];
    const reused = await performCheckin({
      ...config,
      storageState: result.storageState,
      onPhase: (phase) => { phases.push(phase); },
    }, 1);
    assert.equal(reused.status, "success");
    assert.deepEqual(phases, ["checkin"]);
  });
  it("accepts a stable SPA dashboard route while the login form is still unloading", async () => {
    const config: AppConfig = {
      targetUrl: baseUrl + "/checkin",
      loginUrl: baseUrl + "/slow-login",
      timezone: "Asia/Shanghai",
      cronExpression: "0 0 8 * * *",
      headless: true,
      email: "fixture-user",
      password: "fixture-password",
      navigationTimeoutMs: 10_000,
      actionTimeoutMs: 2_000,
      retryCount: 0,
      retryDelayMs: 0,
      logPath: path.join(directory, "run.jsonl"),
      screenshotDir: directory,
      lockPath: path.join(directory, "run.lock"),
      loginButtonTexts: ["Sign in"],
      checkinButtonSelectors: [],
      successSelectors: [],
      alreadyCheckedSelectors: [],
      challengeSelectors: [".captcha"],
      checkinButtonTexts: ["Claim"],
      successTexts: ["Claimed"],
      alreadyCheckedTexts: ["Already claimed"],
      challengeTexts: ["Captcha"],
    };

    const result = await performCheckin(config, 1);
    assert.equal(result.status, "success");
  });
  it("falls back to credentials once and then reuses the saved session", async () => {
    const phases: string[] = [];
    const config: AppConfig = {
      targetUrl: baseUrl + "/protected",
      loginUrl: baseUrl + "/session-login",
      storageState: JSON.stringify({ cookies: [], origins: [] }),
      onPhase: (phase) => { phases.push(phase); },
      timezone: "Asia/Shanghai",
      cronExpression: "0 0 8 * * *",
      headless: true,
      email: "fixture-user",
      password: "fixture-password",
      navigationTimeoutMs: 10_000,
      actionTimeoutMs: 5_000,
      retryCount: 0,
      retryDelayMs: 0,
      logPath: path.join(directory, "run.jsonl"),
      screenshotDir: directory,
      lockPath: path.join(directory, "run.lock"),
      loginButtonTexts: ["Sign in"],
      checkinButtonSelectors: ["#daily"],
      successSelectors: [],
      alreadyCheckedSelectors: [],
      challengeSelectors: [".captcha"],
      checkinButtonTexts: ["Claim"],
      successTexts: ["Claimed"],
      alreadyCheckedTexts: ["Already claimed"],
      challengeTexts: ["Captcha"],
    };
    const first = await performCheckin(config, 1);
    assert.equal(first.status, "success");
    assert.ok(first.storageState);
    assert.deepEqual(phases, ["checkin", "login", "checkin"]);

    phases.length = 0;
    const second = await performCheckin({ ...config, storageState: first.storageState }, 1);
    assert.equal(second.status, "success");
    assert.deepEqual(phases, ["checkin"]);
  });
  it("stops on ambiguous buttons and honors an advanced selector", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(
      "<button id='first'>签到</button><button id='second'>签到</button>",
    );
    const config: AppConfig = {
      targetUrl: "https://example.com/checkin",
      loginUrl: "https://example.com/login",
      timezone: "Asia/Shanghai",
      cronExpression: "0 0 8 * * *",
      headless: true,
      navigationTimeoutMs: 10_000,
      actionTimeoutMs: 5_000,
      retryCount: 0,
      retryDelayMs: 0,
      logPath: path.join(directory, "run.jsonl"),
      screenshotDir: directory,
      lockPath: path.join(directory, "run.lock"),
      loginButtonTexts: ["登录"],
      checkinButtonSelectors: [],
      successSelectors: [],
      alreadyCheckedSelectors: [],
      challengeSelectors: [".captcha"],
      checkinButtonTexts: ["签到"],
      successTexts: ["签到成功"],
      alreadyCheckedTexts: ["今日已签到"],
      challengeTexts: ["验证码"],
    };
    await assert.rejects(
      () => findCheckinButton(page, config),
      PageChangedError,
    );

    config.checkinButtonSelectors = ["#second"];
    const selected = await findCheckinButton(page, config);
    assert.equal(await selected?.getAttribute("id"), "second");

    config.checkinButtonSelectors = [];
    config.checkinButtonTexts = ["签到", "领取"];
    await page.setContent(
      '<a href="plugin.php?id=fx_checkin"><img id="fx_checkin_b" alt="签到领奖" src="mini.gif"></a>',
    );
    const imageEntry = await findCheckinButton(page, config);
    assert.equal(await imageEntry?.getAttribute("id"), "fx_checkin_b");

    await page.setContent(
      '<a id="first-entry" href="/daily-checkin">One</a><a id="second-entry" href="/plugin/checkin">Two</a>',
    );
    await assert.rejects(
      () => findCheckinButton(page, config),
      PageChangedError,
    );

    await page.setContent('<a id="logout" href="/signout">Sign out</a>');
    assert.equal(await findCheckinButton(page, config), undefined);
    await browser.close();
  });
});
