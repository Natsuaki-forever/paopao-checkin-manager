import type { CheckinAdapter, CheckinAdapterResult, ResolvedProxy } from "./types.js";
import type { SystemSettings, TaskSummary } from "../../shared/types.js";
import { executeHttpFlow } from "../http-flow/executor.js";

const stateOrigin = "https://http-flow.local";

export class HttpFlowAdapter implements CheckinAdapter {
  readonly templateId = "http_flow" as const;
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
    if (!task.httpFlowConfig) throw new Error("HTTP 流程模板配置缺失");
    await onPhase?.("checkin");
    const startedAt = new Date().toISOString();
    const cookies = readCookies(storageState);
    const proxyUrl = proxy ? new URL(proxy.server) : undefined;
    if (proxyUrl && proxy?.username) {
      proxyUrl.username = proxy.username;
      proxyUrl.password = proxy.password || "";
    }
    const result = await executeHttpFlow(task.httpFlowConfig, {
      variables: { username: credentials.username },
      secrets: { password: credentials.password },
      cookies,
      proxy: proxyUrl?.toString(),
      shouldCancel,
    }, {
      maxResponseBytes: 2 * 1024 * 1024,
      maxRedirects: 5,
      stepTimeoutMs: settings.actionTimeoutMs,
      totalTimeoutMs: settings.navigationTimeoutMs,
    });
    return {
      status: "success",
      message: `HTTP 流程完成 ${result.summaries.length} 个步骤`,
      startedAt,
      finishedAt: new Date().toISOString(),
      attempt,
      finalUrl: result.summaries.at(-1)?.finalUrl,
      detectionSignals: result.summaries.map((item) => `http.${item.stepId}.${item.status}`),
      storageState: JSON.stringify({ cookies: [], origins: [{
        origin: stateOrigin,
        localStorage: [{ name: "cookies", value: JSON.stringify(result.cookies) }],
      }] }),
    };
  }
}

function readCookies(storageState?: string): Record<string, string> {
  if (!storageState) return {};
  try {
    const state = JSON.parse(storageState) as { origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> };
    const value = state.origins?.find((item) => item.origin === stateOrigin)
      ?.localStorage.find((item) => item.name === "cookies")?.value;
    return value ? JSON.parse(value) : {};
  } catch { return {}; }
}
