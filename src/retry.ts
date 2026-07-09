import { CheckinError } from "./errors.js";

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  retryCount: number,
  retryDelayMs: number,
  onRetry?: (error: unknown, nextAttempt: number) => void | Promise<void>,
): Promise<T> {
  const maxAttempts = retryCount + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const retryable =
        error instanceof CheckinError ? error.retryable : false;
      if (!retryable || attempt >= maxAttempts) throw error;
      await onRetry?.(error, attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error("重试流程意外结束");
}
