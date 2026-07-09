import path from "node:path";
import { config as loadDotenv } from "dotenv";
import type { AppConfig } from "./types.js";

loadDotenv();

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parsePositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
  return parsed;
}

export function splitList(
  value: string | undefined,
  separator: string,
  fallback: string[] = [],
): string[] {
  if (!value?.trim()) return fallback;
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(cwd = process.cwd()): AppConfig {
  const targetUrl =
    process.env.TARGET_URL?.trim() || "https://dash.lynvx.info/#/checkin";
  const loginUrl =
    process.env.LOGIN_URL?.trim() || "https://dash.lynvx.info/#/login";
  try {
    new URL(targetUrl);
    new URL(loginUrl);
  } catch {
    throw new Error("TARGET_URL 和 LOGIN_URL 必须是有效网址");
  }

  return {
    targetUrl,
    loginUrl,
    timezone: process.env.TIMEZONE?.trim() || "Asia/Shanghai",
    cronExpression: process.env.CRON_EXPRESSION?.trim() || "0 0 8 * * *",
    headless: parseBoolean(process.env.HEADLESS, true),
    proxyServer: process.env.PROXY_SERVER?.trim() || undefined,
    email: process.env.LYNVX_EMAIL?.trim() || undefined,
    password: process.env.LYNVX_PASSWORD || undefined,
    navigationTimeoutMs: parsePositiveInteger(
      "NAVIGATION_TIMEOUT_MS",
      process.env.NAVIGATION_TIMEOUT_MS,
      60_000,
    ),
    actionTimeoutMs: parsePositiveInteger(
      "ACTION_TIMEOUT_MS",
      process.env.ACTION_TIMEOUT_MS,
      20_000,
    ),
    retryCount: parsePositiveInteger(
      "RETRY_COUNT",
      process.env.RETRY_COUNT,
      2,
    ),
    retryDelayMs: parsePositiveInteger(
      "RETRY_DELAY_MS",
      process.env.RETRY_DELAY_MS,
      10_000,
    ),
    wechatWebhookUrl: process.env.WECHAT_WEBHOOK_URL?.trim() || undefined,
    serverChanSendKey: process.env.SERVERCHAN_SENDKEY?.trim() || undefined,
    logPath: path.resolve(cwd, "logs", "checkin.jsonl"),
    screenshotDir: path.resolve(cwd, "screenshots"),
    lockPath: path.resolve(cwd, "data", "checkin.lock"),
    usernameSelector: process.env.USERNAME_SELECTOR?.trim() || undefined,
    passwordSelector: process.env.PASSWORD_SELECTOR?.trim() || undefined,
    loginButtonSelector: process.env.LOGIN_BUTTON_SELECTOR?.trim() || undefined,
    loginButtonTexts: splitList(process.env.LOGIN_BUTTON_TEXTS, "|", [
      "登录",
      "登入",
      "Login",
      "Sign in",
      "继续",
    ]),
    checkinButtonSelectors: splitList(
      process.env.CHECKIN_BUTTON_SELECTORS,
      ",",
      [".claim-button"],
    ),
    successSelectors: splitList(process.env.SUCCESS_SELECTORS, ","),
    alreadyCheckedSelectors: splitList(
      process.env.ALREADY_CHECKED_SELECTORS,
      ",",
    ),
    challengeSelectors: splitList(process.env.CHALLENGE_SELECTORS, ",", [
      'iframe[src*="captcha"]',
      'iframe[src*="challenge"]',
      'iframe[src*="turnstile"]',
      ".captcha",
      ".geetest_panel",
      ".tcaptcha-transform",
      ".cf-turnstile",
    ]),
    checkinButtonTexts: splitList(
      process.env.CHECKIN_BUTTON_TEXTS,
      "|",
      ["立即签到", "每日签到", "点击签到", "签到"],
    ),
    successTexts: splitList(process.env.SUCCESS_TEXTS, "|", [
      "签到成功",
      "今日已签到",
      "今天已签到",
      "已完成签到",
    ]),
    alreadyCheckedTexts: splitList(
      process.env.ALREADY_CHECKED_TEXTS,
      "|",
      ["今日已签到", "今天已签到", "已完成签到"],
    ),
    challengeTexts: splitList(process.env.CHALLENGE_TEXTS, "|", [
      "人机验证",
      "安全验证",
      "滑块验证",
      "请完成验证",
    ]),
  };
}
