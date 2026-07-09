import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeBrowserFormTemplateConfig } from "../../shared/browser-form.js";
import type { SystemSettings, TaskSummary } from "../../shared/types.js";
import type {
  CheckinAdapter,
  CheckinAdapterResult,
  ResolvedProxy,
} from "./types.js";

interface LegacyConfig {
  targetUrl: string;
  loginUrl: string;
  timezone: string;
  cronExpression: string;
  headless: boolean;
  proxyServer?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  email?: string;
  password?: string;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
  logPath: string;
  screenshotDir: string;
  lockPath: string;
  usernameSelector?: string;
  passwordSelector?: string;
  loginButtonSelector?: string;
  loginSuccessSelector?: string;
  loginSuccessUrlIncludes?: string;
  loginButtonTexts: string[];
  checkinButtonSelectors: string[];
  successSelectors: string[];
  alreadyCheckedSelectors: string[];
  challengeSelectors: string[];
  checkinButtonTexts: string[];
  successTexts: string[];
  alreadyCheckedTexts: string[];
  challengeTexts: string[];
  onPhase?: (phase: "login" | "checkin") => void | Promise<void>;
  storageState?: string;
  shouldCancel?: () => boolean;
}

type PerformCheckin = (
  config: LegacyConfig,
  attempt: number,
) => Promise<CheckinAdapterResult>;

export class BrowserFormAdapter implements CheckinAdapter {
  readonly templateId = "browser_form" as const;
  private performCheckin?: PerformCheckin;

  constructor(
    private readonly modulePath: string,
    private readonly screenshotDir: string,
  ) {}

  private async load(): Promise<PerformCheckin> {
    if (this.performCheckin) return this.performCheckin;
    await access(this.modulePath).catch(() => {
      throw new Error(
        "通用网页登录执行模块尚未构建：" + this.modulePath,
      );
    });
    const module = (await import(pathToFileURL(this.modulePath).href)) as {
      performCheckin?: PerformCheckin;
    };
    if (!module.performCheckin) {
      throw new Error("通用网页登录执行模块入口无效");
    }
    this.performCheckin = module.performCheckin;
    return this.performCheckin;
  }

  async run(
    task: TaskSummary,
    credentials: { username: string; password: string },
    settings: SystemSettings,
    attempt: number,
    onPhase?: (phase: "login" | "checkin" | "notify") => void | Promise<void>,
    storageState?: string,
    proxy?: ResolvedProxy,
    shouldCancel?: () => boolean,
  ): Promise<CheckinAdapterResult> {
    const performCheckin = await this.load();
    const template = normalizeBrowserFormTemplateConfig(task.templateConfig);
    const config: LegacyConfig = {
      targetUrl: task.checkinUrl,
      loginUrl: task.loginUrl,
      timezone: task.timezone,
      cronExpression: "0 0 8 * * *",
      headless: true,
      proxyServer: proxy?.server,
      proxyUsername: proxy?.username,
      proxyPassword: proxy?.password,
      email: credentials.username,
      password: credentials.password,
      navigationTimeoutMs: settings.navigationTimeoutMs,
      actionTimeoutMs: settings.actionTimeoutMs,
      retryCount: settings.retryCount,
      retryDelayMs: settings.retryDelayMs,
      logPath: path.join(path.dirname(this.screenshotDir), "browser-form-unused.jsonl"),
      screenshotDir: this.screenshotDir,
      lockPath: path.join(path.dirname(this.screenshotDir), "browser-form-unused.lock"),
      usernameSelector: template.usernameSelector,
      passwordSelector: template.passwordSelector,
      loginButtonSelector: template.loginButtonSelector,
      loginSuccessSelector: template.loginSuccessSelector,
      loginSuccessUrlIncludes: template.loginSuccessUrlIncludes,
      loginButtonTexts: template.loginButtonTexts || [],
      checkinButtonSelectors: template.checkinButtonSelector
        ? [template.checkinButtonSelector]
        : [".claim-button"],
      successSelectors: [],
      alreadyCheckedSelectors: [],
      challengeSelectors: [
        'iframe[src*="captcha"]',
        'iframe[src*="challenge"]',
        'iframe[src*="turnstile"]',
        ".captcha",
        ".geetest_panel",
        ".tcaptcha-transform",
        ".cf-turnstile",
      ],
      checkinButtonTexts: template.checkinButtonTexts || [],
      successTexts: template.successTexts || [],
      alreadyCheckedTexts: template.alreadyCheckedTexts || [],
      challengeTexts: [
        "人机验证",
        "安全验证",
        "滑块验证",
        "请完成验证",
        "验证码",
        "扫码登录",
        "二次验证",
      ],
      onPhase,
      storageState,
      shouldCancel,
    };
    return performCheckin(config, attempt);
  }
}
