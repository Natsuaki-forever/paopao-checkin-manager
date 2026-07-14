export type RunStatus =
  | "success"
  | "already_checked"
  | "auth_required"
  | "challenge"
  | "page_changed"
  | "session_expired"
  | "proxy_failure"
  | "cancelled"
  | "failure";

export type RunTrigger = "manual" | "scheduled";
export type RunPhase = "queued" | "login" | "checkin" | "notify";
export type RunJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type NotificationChannel = "serverchan" | "wechat" | "bark" | "telegram" | "webhook";
export type TemplateStatus = "success" | "already_checked" | "failure";

export type TaskTemplateId = "browser_form" | "http_flow";
export type ProxyMode = "inherit" | "direct" | "custom";

export interface BrowserFormTemplateConfig {
  version: 1;
  usernameSelector?: string;
  passwordSelector?: string;
  loginButtonSelector?: string;
  loginSuccessSelector?: string;
  loginSuccessUrlIncludes?: string;
  checkinButtonSelector?: string;
  loginButtonTexts?: string[];
  checkinButtonTexts?: string[];
  successTexts?: string[];
  alreadyCheckedTexts?: string[];
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface HttpFlowExtraction {
  variable: string;
  source: "jsonpath" | "header" | "cookie" | "regex";
  expression: string;
  secret?: boolean;
}
export interface HttpFlowStep {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
  assertions?: { status?: number[]; includes?: string[]; excludes?: string[] };
  extracts?: HttpFlowExtraction[];
}
export interface HttpFlowTemplateV1 {
  version: 1;
  kind: "http_flow";
  steps: HttpFlowStep[];
}

export interface AuthState {
  requiresSetup: boolean;
  authenticated: boolean;
  mode: "simulation" | "production";
  registrationEnabled: boolean;
  registrationMode?: "closed" | "invite" | "public";
  role?: "user" | "admin";
  displayName?: string;
  owner?: boolean;
  capabilities?: UserCapabilities;
  quotas?: UserQuotas;
}

export interface UserCapabilities {
  scheduleTasks: boolean;
  runTasksManually: boolean;
  useManualLogin: boolean;
  importHar: boolean;
  useHttpFlow: boolean;
  useCustomProxy: boolean;
  submitSharedTemplates: boolean;
}

export interface UserQuotas {
  maxTasks: number;
  maxEnabledTasks: number;
  maxDailyActions: number;
}

export const defaultUserCapabilities: UserCapabilities = {
  scheduleTasks: true,
  runTasksManually: true,
  useManualLogin: true,
  importHar: true,
  useHttpFlow: false,
  useCustomProxy: false,
  submitSharedTemplates: true,
};

export const defaultUserQuotas: UserQuotas = {
  maxTasks: 5,
  maxEnabledTasks: 5,
  maxDailyActions: 20,
};

export type UserAccountStatus = "active" | "suspended";

export interface AdminUserSummary {
  id: string;
  username: string;
  role: "user" | "admin";
  status: UserAccountStatus;
  capabilities: UserCapabilities;
  quotas: UserQuotas;
  taskCount: number;
  enabledTaskCount: number;
  templateCount: number;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  actorUserId?: string;
  actorRole: "user" | "admin";
  actorOwner: boolean;
  actorDisplayName: string;
  action: string;
  targetType: string;
  targetId?: string;
  targetLabel?: string;
  result: "success" | "denied" | "failure";
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface TemplateSubmission {
  id: string;
  sourceTemplateId?: string;
  submitterUserId?: string;
  submitterName: string;
  name: string;
  description: string;
  config: BrowserFormTemplateConfig;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  reviewNote?: string;
  publishedTemplateId?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface TaskSummary {
  id: string;
  ownerUserId?: string;
  templateId: TaskTemplateId;
  adapterId: TaskTemplateId;
  templateUuid?: string;
  templateConfig: BrowserFormTemplateConfig;
  httpFlowConfig?: HttpFlowTemplateV1;
  name: string;
  loginUrl: string;
  checkinUrl: string;
  usernameMasked: string;
  hasPassword: boolean;
  scheduleTime: string;
  timezone: string;
  notifyServerChan: boolean;
  notifyWechat: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  latestRun?: RunRecord;
  activeJob?: RunJob;
  sessionStatus?: TaskSessionStatus;
  proxyMode: ProxyMode;
  proxyServer: string;
  proxyUsernameMasked?: string;
  hasProxyPassword: boolean;
  notificationPolicy: TaskNotificationPolicy;
  retryPolicy: TaskRetryPolicy;
  nextRun: string;
  nextRunAt?: string;
}

export type DashboardAttentionKind =
  | "challenge"
  | "auth_required"
  | "session_expired"
  | "page_changed"
  | "proxy_failure"
  | "failure";

export interface DashboardAttentionItem {
  taskId: string;
  taskName: string;
  kind: DashboardAttentionKind;
  severity: "high" | "medium";
  message: string;
  runId?: string;
  action: "manual_login" | "view_run" | "edit_task" | "check_proxy";
}

export interface DashboardResponse {
  generatedAt: string;
  summary: {
    todayPlanned: number;
    todayCompleted: number;
    attentionCount: number;
    nextRunAt?: string;
    validSessionCount: number;
  };
  attention: DashboardAttentionItem[];
  tasks: TaskSummary[];
  admin?: {
    activeUsers: number;
    pendingTemplateSubmissions: number;
    failures24h: number;
  };
}

export interface TaskSessionStatus {
  status: "none" | "valid" | "expired";
  updatedAt?: string;
}

export interface ManualLoginState {
  id: string;
  taskId: string;
  taskName: string;
  url: string;
  title: string;
  expiresAt: string;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ManualElementSelection {
  selector: string;
  label: string;
  tag: string;
  strategy: "id" | "attribute" | "class" | "path";
  rect: { x: number; y: number; width: number; height: number };
}

export interface TaskInput {
  templateId: TaskTemplateId;
  templateConfig: BrowserFormTemplateConfig;
  adapterId?: TaskTemplateId | "lynvx";
  templateUuid?: string;
  name: string;
  loginUrl: string;
  checkinUrl: string;
  username?: string;
  password?: string;
  scheduleTime: string;
  timezone: string;
  notifyServerChan: boolean;
  notifyWechat: boolean;
  enabled: boolean;
  proxyMode?: ProxyMode;
  proxyServer?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  notificationPolicy?: TaskNotificationPolicy;
  retryPolicy?: TaskRetryPolicy;
}

export interface TaskRetryPolicy {
  enabled: boolean;
  immediateRetries: number;
  delayedRetryIntervalMinutes: number;
  delayedRetries: number;
}

export interface TaskNotificationPolicy {
  manual: boolean;
  scheduled: boolean;
  success: boolean;
  failure: boolean;
  failureThreshold: number;
  consecutiveFailures?: number;
}

export interface ExecutionTemplate {
  id: string;
  ownerUserId?: string;
  adapterId: TaskTemplateId;
  name: string;
  description?: string;
  version: number;
  config: BrowserFormTemplateConfig | HttpFlowTemplateV1;
  isPreset: boolean;
  isPrivate: boolean;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
  testedAt?: string;
}

export interface RunRecord {
  id: string;
  ownerUserId?: string;
  taskId?: string;
  taskName: string;
  trigger: RunTrigger;
  status: RunStatus;
  message: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  attempt: number;
  notificationResult: "sent" | "simulated" | "skipped" | "failed";
  phase?: RunPhase;
  finalUrl?: string;
  detectionSignals?: string[];
  errorDetail?: string;
  screenshotPath?: string;
  hasScreenshot?: boolean;
}


export interface RunJob {
  id: string;
  taskId: string;
  trigger: RunTrigger;
  status: RunJobStatus;
  phase: RunPhase;
  scheduledKey?: string;
  queuedAt: string;
  startedAt?: string;
  heartbeatAt?: string;
  finishedAt?: string;
  runId?: string;
  errorDetail?: string;
  retryNumber?: number;
  nextRetryAt?: string;
  failureClass?: "network" | "proxy" | "challenge" | "auth" | "page" | "assertion";
  cancelRequested?: boolean;
}

export interface RunJobEnqueueResponse extends RunJob {
  jobId: string;
  created: boolean;
}
export interface RunListResponse {
  items: RunRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export interface NotificationChannelConfig {
  channel: NotificationChannel;
  enabled: boolean;
  configured: boolean;
  secretMasked: string;
}

export interface NotificationTemplate {
  channel: NotificationChannel;
  status: TemplateStatus;
  content: string;
}

export interface SystemSettings {
  retryCount: number;
  retryDelayMs: number;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  retentionDays: number;
  screenshotMaxMb: number;
  proxyServer: string;
  sessionHours: number;
  registrationMode: "closed" | "invite" | "public";
  auditRetentionDays: number;
}

export interface StorageUsage {
  screenshotCount: number;
  screenshotBytes: number;
  screenshotMaxBytes: number;
  databaseBytes: number;
  managedBytes: number;
  runRecords: number;
  completedJobs: number;
}

export interface ServiceStatus {
  mode: "simulation" | "production";
  version: string;
  scheduler: "running";
  database: "connected";
  proxy: "not_configured" | "configured_not_tested" | "configured_tested" | "configured_failed";
  proxyTestedAt?: string;
  proxyTestMessage?: string;
  activeRuns: number;
  startedAt: string;
  features: { queue: boolean; session: boolean; httpFlow: boolean };
}

export const templateVariables = [
  "siteName",
  "status",
  "message",
  "finishedAt",
  "duration",
] as const;
