import type {
  RunStatus,
  SystemSettings,
  TaskSummary,
  TaskTemplateId,
} from "../../shared/types.js";

export interface CheckinAdapterResult {
  status: RunStatus | "retryable_failure";
  message: string;
  startedAt: string;
  finishedAt: string;
  attempt: number;
  screenshot?: string;
  finalUrl?: string;
  detectionSignals?: string[];
  storageState?: string;
}

export interface ResolvedProxy {
  server: string;
  username?: string;
  password?: string;
}

export interface AdapterAttemptError extends Error {
  status?: RunStatus | "retryable_failure";
  retryable?: boolean;
  screenshot?: string;
  finalUrl?: string;
  detectionSignals?: string[];
}

export interface CheckinAdapter {
  readonly templateId: TaskTemplateId;
  run(
    task: TaskSummary,
    credentials: { username: string; password: string },
    settings: SystemSettings,
    attempt: number,
    onPhase?: (phase: "login" | "checkin" | "notify") => void | Promise<void>,
    storageState?: string,
    proxy?: ResolvedProxy,
    shouldCancel?: () => boolean,
  ): Promise<CheckinAdapterResult>;
}
