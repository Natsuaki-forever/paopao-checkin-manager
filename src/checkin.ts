import path from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { chromium, errors as playwrightErrors } from "playwright";
import {
  AuthRequiredError,
  ChallengeDetectedError,
  CheckinError,
  PageChangedError,
  RetryableCheckinError,
  SessionExpiredError,
  ProxyFailureError,
  CancelledCheckinError,
} from "./errors.js";
import {
  detectAlreadyChecked,
  detectChallenge,
  detectSuccess,
  findCheckinButton,
  textPattern,
} from "./detection.js";
import type { AppConfig, RunResult } from "./types.js";

interface CheckinApiState {
  checked_in?: boolean;
  already_checked?: boolean;
  enabled?: boolean;
}

function assertNotCancelled(config: AppConfig): void {
  if (config.shouldCancel?.()) throw new CancelledCheckinError();
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = Number.NaN, b = Number.NaN] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = address.toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd")
    || /^fe[89ab]/.test(value) || value.startsWith("ff");
}

async function installNetworkGuard(context: import("playwright").BrowserContext): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  await context.route("**/*", async (route) => {
    try {
      const url = new URL(route.request().url());
      if (["about:", "data:", "blob:"].includes(url.protocol)) return await route.continue();
      if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
        return await route.abort("blockedbyclient");
      }
      const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true, verbatim: true });
      if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) return await route.abort("blockedbyclient");
      return await route.continue();
    } catch {
      return await route.abort("blockedbyclient");
    }
  });
}

interface BlockingOverlay {
  name: string;
  selector: string;
  closeSelectors: string[];
  waitForEnabled?: boolean;
  allowBackdropClick?: boolean;
}

const blockingOverlays: BlockingOverlay[] = [
  {
    name: "登录公告",
    selector: ".auth-popup-overlay",
    closeSelectors: [
      ".auth-popup-footer button",
      ".auth-popup-actions button",
      ".auth-popup-content + .auth-popup-footer button",
      'button[aria-label*="关闭"]',
      'button[title*="关闭"]',
      ".auth-popup-close",
      ".close-button",
      ".close-btn",
      "button:last-of-type",
    ],
    waitForEnabled: true,
  },
  {
    name: "活动促销",
    selector: ".promotion-overlay",
    closeSelectors: [
      ".promotion-close",
      ".promotion-footer button",
      ".promotion-actions button",
      'button[aria-label="关闭活动弹窗"]',
      'button[aria-label*="关闭"]',
      'button[title*="关闭"]',
      ".close-button",
      ".close-btn",
    ],
    allowBackdropClick: true,
  },
  {
    name: "页面弹窗",
    selector:
      '.modal-overlay, .popup-overlay, .dialog-overlay, [role="dialog"][aria-modal="true"]',
    closeSelectors: [
      'button[aria-label*="关闭"]',
      'button[aria-label*="close" i]',
      'button[title*="关闭"]',
      'button[title*="close" i]',
      ".modal-close",
      ".popup-close",
      ".dialog-close",
      ".close-btn",
      "button.close",
    ],
  },
];

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function findCheckinState(value: unknown): CheckinApiState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  if (
    "checked_in" in object ||
    "already_checked" in object ||
    ("enabled" in object &&
      ("continuous_days" in object || "consecutive_days" in object))
  ) {
    return {
      checked_in:
        typeof object.checked_in === "boolean"
          ? object.checked_in
          : undefined,
      already_checked:
        typeof object.already_checked === "boolean"
          ? object.already_checked
          : undefined,
      enabled:
        typeof object.enabled === "boolean" ? object.enabled : undefined,
    };
  }
  for (const child of Object.values(object)) {
    const found = findCheckinState(child);
    if (found) return found;
  }
  return undefined;
}

async function captureFailure(
  page: import("playwright").Page,
  config: AppConfig,
): Promise<string | undefined> {
  const screenshotPath = path.join(
    config.screenshotDir,
    `failure-${timestampForFilename()}.png`,
  );
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  } catch {
    return undefined;
  }
}

async function disableFrontendWindowCloser(
  context: import("playwright").BrowserContext,
): Promise<void> {
  await context.addInitScript(() => {
    const noop = () => undefined;
    for (const method of [
      "clear",
      "debug",
      "dir",
      "dirxml",
      "error",
      "group",
      "groupCollapsed",
      "groupEnd",
      "info",
      "log",
      "profile",
      "profileEnd",
      "table",
      "time",
      "timeEnd",
      "timeStamp",
      "trace",
      "warn",
    ]) {
      try {
        Object.defineProperty(console, method, {
          configurable: true,
          value: noop,
        });
      } catch {
        // Ignore browser-specific non-configurable properties.
      }
    }
    try {
      Object.defineProperty(window, "close", {
        configurable: true,
        value: noop,
      });
    } catch {
      // The page remains usable if window.close cannot be replaced.
    }
  });
}

async function firstVisibleCloseButton(
  overlay: import("playwright").Locator,
  selectors: string[],
): Promise<import("playwright").Locator[]> {
  const found: import("playwright").Locator[] = [];
  for (const selector of selectors) {
    const candidates = overlay.locator(selector);
    const count = Math.min(await candidates.count().catch(() => 0), 5);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible().catch(() => false)) found.push(candidate);
    }
  }
  return found;
}

async function closeBlockingOverlay(
  page: import("playwright").Page,
  definition: BlockingOverlay,
): Promise<boolean> {
  const overlays = page.locator(definition.selector);
  const count = Math.min(await overlays.count().catch(() => 0), 5);

  for (let index = 0; index < count; index += 1) {
    const overlay = overlays.nth(index);
    if (!(await overlay.isVisible().catch(() => false))) continue;

    const closeButtons = await firstVisibleCloseButton(
      overlay,
      definition.closeSelectors,
    );

    for (const closeButton of closeButtons) {
      try {
        if (definition.waitForEnabled) {
          await closeButton.waitFor({ state: "visible", timeout: 5_000 });
          const handle = await closeButton.elementHandle();
          if (!handle) continue;
          await page
            .waitForFunction(
              (button) =>
                button instanceof HTMLButtonElement
                  ? !button.disabled
                  : button.getAttribute("aria-disabled") !== "true",
              handle,
              { timeout: 5_000 },
            )
            .catch(() => undefined);
        }
        await closeButton.click({ timeout: 5_000 });
        await overlay.waitFor({ state: "hidden", timeout: 2_000 });
        console.log(`已关闭页面弹窗：${definition.name}`);
        return true;
      } catch {
        if (!(await overlay.isVisible().catch(() => false))) {
          console.log(`已关闭页面弹窗：${definition.name}`);
          return true;
        }
      }
    }

    if (definition.allowBackdropClick) {
      // This known overlay also closes when its backdrop receives the click.
      await overlay.evaluate((element) => {
        if (element instanceof HTMLElement) element.click();
      });
      await overlay.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => undefined);
      if (!(await overlay.isVisible().catch(() => false))) {
        console.log(`已关闭页面弹窗：${definition.name}`);
        return true;
      }
    } else {
      throw new PageChangedError(
        `检测到${definition.name}遮挡页面，但未找到安全的关闭按钮`,
      );
    }

    throw new PageChangedError(
      `检测到${definition.name}遮挡页面，但所有关闭方式均未生效`,
    );
  }
  return false;
}

async function dismissBlockingOverlays(
  page: import("playwright").Page,
): Promise<void> {
  let clearPasses = 0;
  for (let pass = 0; pass < 8 && clearPasses < 2; pass += 1) {
    let closed = false;
    for (const definition of blockingOverlays) {
      if (await closeBlockingOverlay(page, definition)) {
        closed = true;
        break;
      }
    }
    clearPasses = closed ? 0 : clearPasses + 1;
    await page.waitForTimeout(closed ? 300 : 500);
  }
}

async function uniqueVisible(
  locator: import("playwright").Locator,
  label: string,
  requireEnabled = false,
): Promise<import("playwright").Locator | undefined> {
  const count = Math.min(await locator.count().catch(() => 0), 20);
  let found: import("playwright").Locator | undefined;
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (
      requireEnabled &&
      !(await candidate.isEnabled().catch(() => false))
    ) {
      continue;
    }
    if (found) {
      throw new PageChangedError(
        "检测到多个可用的" + label + "，为避免误操作已停止",
      );
    }
    found = candidate;
  }
  return found;
}

async function findLoginControl(
  page: import("playwright").Page,
  configuredSelector: string | undefined,
  fallbackSelectors: string[],
  label: string,
): Promise<import("playwright").Locator> {
  if (configuredSelector) {
    try {
      const configured = await uniqueVisible(
        page.locator(configuredSelector),
        label,
      );
      if (configured) return configured;
      throw new PageChangedError("未找到高级配置指定的" + label);
    } catch (error) {
      if (error instanceof PageChangedError) throw error;
      throw new PageChangedError(label + "选择器无效");
    }
  }

  for (const selector of fallbackSelectors) {
    const candidate = await uniqueVisible(page.locator(selector), label);
    if (candidate) return candidate;
  }
  throw new PageChangedError("未找到明确的" + label);
}

async function findLoginButton(
  page: import("playwright").Page,
  config: AppConfig,
): Promise<import("playwright").Locator> {
  if (config.loginButtonSelector) {
    try {
      const configured = await uniqueVisible(
        page.locator(config.loginButtonSelector),
        "登录按钮",
        true,
      );
      if (configured) return configured;
      throw new PageChangedError("未找到高级配置指定的登录按钮");
    } catch (error) {
      if (error instanceof PageChangedError) throw error;
      throw new PageChangedError("登录按钮选择器无效");
    }
  }

  const pattern = textPattern(config.loginButtonTexts, true);
  const button = await uniqueVisible(
    page.getByRole("button", { name: pattern }),
    "登录按钮",
    true,
  );
  if (button) return button;
  throw new PageChangedError("未找到明确的登录按钮");
}

const loginRouteMarkers = ["login", "signin", "sign-in", "sign_in"];

function hasClearlyLeftLoginRoute(loginUrl: string, currentUrl: string): boolean {
  if (currentUrl === loginUrl) return false;
  const normalizedLogin = loginUrl.toLowerCase();
  const normalizedCurrent = currentUrl.toLowerCase();
  const markers = loginRouteMarkers.filter((marker) =>
    normalizedLogin.includes(marker),
  );
  return markers.length > 0 && markers.every((marker) =>
    !normalizedCurrent.includes(marker),
  );
}

async function waitForLoginSuccess(
  page: import("playwright").Page,
  config: AppConfig,
  passwordInput: import("playwright").Locator,
  loginUrlBeforeClick: string,
): Promise<void> {
  const timeoutMs = Math.max(
    30_000,
    Math.min(config.navigationTimeoutMs, 60_000),
  );
  const deadline = Date.now() + timeoutMs;
  let leftLoginRouteAt: number | undefined;
  let successLocator: import("playwright").Locator | undefined;

  if (config.loginSuccessSelector) {
    try {
      successLocator = page.locator(config.loginSuccessSelector);
      await successLocator.count();
    } catch {
      throw new PageChangedError("登录成功 CSS 选择器无效");
    }
  }

  while (Date.now() < deadline) {
    if (await detectChallenge(page, config)) {
      throw new ChallengeDetectedError(
        "登录后出现验证码、人机验证或二次验证",
      );
    }

    if (
      successLocator &&
      (await successLocator.first().isVisible().catch(() => false))
    ) {
      return;
    }

    const currentUrl = page.url();
    if (
      config.loginSuccessUrlIncludes &&
      currentUrl.includes(config.loginSuccessUrlIncludes)
    ) {
      return;
    }

    if (!(await passwordInput.isVisible().catch(() => false))) {
      return;
    }

    if (hasClearlyLeftLoginRoute(loginUrlBeforeClick, currentUrl)) {
      leftLoginRouteAt ??= Date.now();
      if (Date.now() - leftLoginRouteAt >= 3_000) return;
    } else {
      leftLoginRouteAt = undefined;
    }

    await page.waitForTimeout(500);
  }

  throw new AuthRequiredError(
    "登录等待超时：页面仍停留在登录状态，请检查账号、密码或配置登录成功标志",
  );
}

async function login(
  page: import("playwright").Page,
  config: AppConfig,
): Promise<void> {
  if (!config.email || !config.password) {
    throw new AuthRequiredError("未配置登录用户名或密码");
  }

  await page.goto(config.loginUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.navigationTimeoutMs,
  });
  await page.waitForLoadState("networkidle", {
    timeout: Math.min(config.navigationTimeoutMs, 15_000),
  }).catch(() => undefined);

  await dismissBlockingOverlays(page);
  if (await detectChallenge(page, config)) {
    throw new ChallengeDetectedError("登录页面出现验证码或人机验证");
  }

  const usernameInput = await findLoginControl(
    page,
    config.usernameSelector,
    [
      'input[type="email"]',
      'input[autocomplete="username"]',
      'input[name*="email" i]',
      'input[name*="user" i]',
      'input[name*="account" i]',
      'input[type="text"]',
    ],
    "账号输入框",
  );
  const passwordInput = await findLoginControl(
    page,
    config.passwordSelector,
    ['input[type="password"]'],
    "密码输入框",
  );
  const loginButton = await findLoginButton(page, config);
  const loginUrlBeforeClick = page.url();

  await usernameInput.fill(config.email);
  await passwordInput.fill(config.password);
  assertNotCancelled(config);
  await loginButton.click();
  await waitForLoginSuccess(
    page,
    config,
    passwordInput,
    loginUrlBeforeClick,
  );
  await page.waitForLoadState("networkidle", {
    timeout: Math.min(config.actionTimeoutMs, 5_000),
  }).catch(() => undefined);
  await dismissBlockingOverlays(page);
}

export async function performCheckin(
  config: AppConfig,
  attempt: number,
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const storedState = config.storageState
    ? JSON.parse(config.storageState)
    : undefined;
  const browser = await chromium.launch({
    headless: config.headless,
    proxy: config.proxyServer
      ? {
          server: config.proxyServer,
          username: config.proxyUsername,
          password: config.proxyPassword,
        }
      : undefined,
  });
  const context = await browser.newContext({
    locale: "zh-CN",
    timezoneId: config.timezone,
    storageState: storedState,
  });
  await installNetworkGuard(context);
  await disableFrontendWindowCloser(context);
  const page = await context.newPage();
  const checkinStates: CheckinApiState[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (!["fetch", "xhr"].includes(request.resourceType())) return;
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("json")) return;
    void response
      .json()
      .then((body) => {
        const state = findCheckinState(body);
        if (state) checkinStates.push(state);
      })
      .catch(() => undefined);
  });
  page.setDefaultTimeout(config.actionTimeoutMs);
  page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  const serializedState = async () => JSON.stringify(await context.storageState());

  try {
    let sessionValid = false;
    let sessionExpired = false;
    if (config.storageState) {
      await config.onPhase?.("checkin");
      assertNotCancelled(config);
      await page.goto(config.targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.navigationTimeoutMs,
      });
      await page.waitForLoadState("networkidle", {
        timeout: Math.min(config.navigationTimeoutMs, 15_000),
      }).catch(() => undefined);
      await dismissBlockingOverlays(page);
      if (await detectChallenge(page, config)) throw new ChallengeDetectedError();
      const passwordVisible = await page.locator('input[type="password"]').first()
        .isVisible().catch(() => false);
      const onLoginRoute = loginRouteMarkers.some((marker) =>
        page.url().toLowerCase().includes(marker),
      );
      sessionValid = !passwordVisible && !onLoginRoute;
      sessionExpired = !sessionValid;
    }
    if (!sessionValid) {
      await config.onPhase?.("login");
      assertNotCancelled(config);
      try {
        await login(page, config);
      } catch (error) {
        if (sessionExpired && error instanceof AuthRequiredError) {
          throw new SessionExpiredError(undefined, { cause: error });
        }
        throw error;
      }
    }
    if (!sessionValid) {
      await config.onPhase?.("checkin");
      assertNotCancelled(config);
      await page.goto(config.targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.navigationTimeoutMs,
      });
    }
    await page.waitForLoadState("networkidle", {
      timeout: Math.min(config.navigationTimeoutMs, 15_000),
    }).catch(() => undefined);
    await page.waitForTimeout(5_000);
    await dismissBlockingOverlays(page);

    if (await detectChallenge(page, config)) {
      throw new ChallengeDetectedError();
    }
    const initialApiState = checkinStates.at(-1);
    if (
      initialApiState?.checked_in === true ||
      initialApiState?.already_checked === true
    ) {
      return {
        status: "already_checked",
        message: "签到接口确认今日已经签到，未重复操作",
        startedAt,
        finishedAt: new Date().toISOString(),
        attempt,
        finalUrl: page.url(),
        detectionSignals: ["api.already_checked"],
        storageState: await serializedState(),
      };
    }
    if (await detectAlreadyChecked(page, config)) {
      return {
        status: "already_checked",
        message: "检测到今日已经签到，未重复操作",
        startedAt,
        finishedAt: new Date().toISOString(),
        attempt,
        finalUrl: page.url(),
        detectionSignals: ["api.already_checked"],
        storageState: await serializedState(),
      };
    }
    const claimButton = page.locator(".claim-button").first();
    if (
      (await claimButton.isVisible().catch(() => false)) &&
      !(await claimButton.isEnabled().catch(() => true))
    ) {
      return {
        status: "already_checked",
        message: "签到按钮已禁用，判定今日已经签到",
        startedAt,
        finishedAt: new Date().toISOString(),
        attempt,
        finalUrl: page.url(),
        detectionSignals: ["api.already_checked"],
        storageState: await serializedState(),
      };
    }

    const button = await findCheckinButton(page, config);
    if (!button) throw new PageChangedError();

    if (!(await button.isEnabled().catch(() => false))) {
      return {
        status: "already_checked",
        message: "签到按钮已禁用，判定今日已经签到",
        startedAt,
        finishedAt: new Date().toISOString(),
        attempt,
        finalUrl: page.url(),
        detectionSignals: ["api.already_checked"],
        storageState: await serializedState(),
      };
    }

    // Promotions can be fetched asynchronously after the check-in page renders.
    await dismissBlockingOverlays(page);
    await button.scrollIntoViewIfNeeded();
    assertNotCancelled(config);
    const stateCountBeforeClick = checkinStates.length;
    await button.click({ timeout: config.actionTimeoutMs });
    await page.waitForTimeout(2_000);

    if (await detectChallenge(page, config)) {
      throw new ChallengeDetectedError("点击签到后出现验证，已停止操作");
    }

    const postClickStates = checkinStates.slice(stateCountBeforeClick);
    const claimState = postClickStates.at(-1);
    if (claimState?.already_checked === true) {
      return {
        status: "already_checked",
        message: "签到接口确认今日已经签到",
        startedAt,
        finishedAt: new Date().toISOString(),
        attempt,
        finalUrl: page.url(),
        detectionSignals: ["api.already_checked"],
        storageState: await serializedState(),
      };
    }
    if (claimState?.checked_in === true) {
      return {
        status: "success",
        message: "签到接口确认签到成功",
        startedAt,
        finishedAt: new Date().toISOString(),
        attempt,
        finalUrl: page.url(),
        detectionSignals: ["api.already_checked"],
        storageState: await serializedState(),
      };
    }

    const success = await detectSuccess(page, config, button);
    if (!success) {
      throw new PageChangedError(
        "已点击签到按钮，但未观察到明确的成功状态，请人工核对",
      );
    }

    return {
      status: "success",
      message: "签到成功",
      startedAt,
      finishedAt: new Date().toISOString(),
      attempt,
      finalUrl: page.url(),
      detectionSignals: ["api.already_checked"],
      storageState: await serializedState(),
    };
  } catch (error) {
    const screenshot = await captureFailure(page, config);
    if (error instanceof CheckinError) {
      Object.assign(error, { screenshot, finalUrl: page.url(), detectionSignals: [`error.${error.status}`] });
      throw error;
    }
    if (error instanceof playwrightErrors.TimeoutError) {
      const wrapped = new RetryableCheckinError(
        `页面访问或操作超时：${error.message}`,
        { cause: error },
      );
      Object.assign(wrapped, { screenshot, finalUrl: page.url(), detectionSignals: ["error.timeout"] });
      throw wrapped;
    }
    if (config.proxyServer && /proxy|tunnel|407|socks/i.test(
      error instanceof Error ? error.message : String(error),
    )) {
      const wrapped = new ProxyFailureError(
        `代理访问失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
      Object.assign(wrapped, { screenshot, finalUrl: page.url(), detectionSignals: ["error.proxy"] });
      throw wrapped;
    }
    const wrapped = new RetryableCheckinError(
      `浏览器执行失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
    Object.assign(wrapped, { screenshot, finalUrl: page.url(), detectionSignals: ["error.browser"] });
    throw wrapped;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
