export type RunStatus =
  | "success"
  | "already_checked"
  | "auth_required"
  | "challenge"
  | "page_changed"
  | "session_expired"
  | "proxy_failure"
  | "cancelled"
  | "retryable_failure"
  | "failure";

export interface RunResult {
  status: RunStatus;
  message: string;
  startedAt: string;
  finishedAt: string;
  attempt: number;
  screenshot?: string;
  finalUrl?: string;
  detectionSignals?: string[];
  storageState?: string;
}

export interface AppConfig {
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
  wechatWebhookUrl?: string;
  serverChanSendKey?: string;
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
