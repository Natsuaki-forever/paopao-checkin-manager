import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadConfig, splitList } from "../src/config.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("config", () => {
  it("splits and trims configured lists", () => {
    assert.deepEqual(splitList(" .a, .b ,, .c ", ","), [".a", ".b", ".c"]);
  });

  it("uses the expected daily schedule by default", () => {
    delete process.env.CRON_EXPRESSION;
    delete process.env.TIMEZONE;
    delete process.env.PROXY_SERVER;
    const config = loadConfig("C:\\tmp\\checkin");
    assert.equal(config.cronExpression, "0 0 8 * * *");
    assert.equal(config.timezone, "Asia/Shanghai");
    assert.equal(config.proxyServer, undefined);
  });

  it("loads an explicit browser proxy", () => {
    process.env.PROXY_SERVER = "http://mihomo:7890";
    assert.equal(loadConfig().proxyServer, "http://mihomo:7890");
  });

  it("loads credentials without trimming the password", () => {
    process.env.TARGET_EMAIL = " user@example.com ";
    process.env.TARGET_PASSWORD = " password with spaces ";
    const config = loadConfig();
    assert.equal(config.email, "user@example.com");
    assert.equal(config.password, " password with spaces ");
  });

  it("rejects an invalid target URL", () => {
    process.env.TARGET_URL = "not-a-url";
    assert.throws(() => loadConfig(), /TARGET_URL/);
  });
});
