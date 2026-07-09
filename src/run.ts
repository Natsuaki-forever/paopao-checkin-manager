import { performCheckin } from "./checkin.js";
import { CheckinError } from "./errors.js";
import {
  acquireLock,
  appendRunLog,
  ensureRuntimeDirectories,
} from "./fs-utils.js";
import { notifyResult } from "./notifier.js";
import { withRetry } from "./retry.js";
import type { AppConfig, RunResult } from "./types.js";

function resultFromError(error: unknown, attempt: number): RunResult {
  const now = new Date().toISOString();
  if (error instanceof CheckinError) {
    return {
      status: error.status === "retryable_failure" ? "failure" : error.status,
      message: error.message,
      startedAt: now,
      finishedAt: now,
      attempt,
      screenshot: (error as CheckinError & { screenshot?: string }).screenshot,
    };
  }
  return {
    status: "failure",
    message: error instanceof Error ? error.message : String(error),
    startedAt: now,
    finishedAt: now,
    attempt,
  };
}

export async function runCheckin(config: AppConfig): Promise<RunResult> {
  await ensureRuntimeDirectories();
  const releaseLock = await acquireLock(config.lockPath);
  let finalAttempt = 1;

  try {
    const result = await withRetry(
      async (attempt) => {
        finalAttempt = attempt;
        return performCheckin(config, attempt);
      },
      config.retryCount,
      config.retryDelayMs,
      async (error, nextAttempt) => {
        console.warn(
          `第 ${nextAttempt - 1} 次执行失败，将进行第 ${nextAttempt} 次尝试：`,
          error instanceof Error ? error.message : error,
        );
      },
    ).catch((error: unknown) => resultFromError(error, finalAttempt));

    try {
      await notifyResult(config, result, config.targetUrl);
    } catch (notifyError) {
      result.message += `；${notifyError instanceof Error ? notifyError.message : String(notifyError)}`;
    }

    await appendRunLog(config.logPath, result);
    return result;
  } finally {
    await releaseLock();
  }
}
