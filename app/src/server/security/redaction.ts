const redacted = "[REDACTED]";

const sensitiveKey = /(?:pass(?:word)?|secret|token|cookie|authorization|api[-_]?key|sendkey|webhook|credential|session|username|email)/i;

export function redactText(input: string): string {
  return input
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${redacted}`)
    .replace(
      /([?&](?:password|secret|token|key|sendkey|access_token|authorization)=)[^&#\s]*/gi,
      `$1${redacted}`,
    )
    .replace(
      /((?:password|secret|token|cookie|authorization|sendkey|webhook)\s*[=:]\s*["']?)[^\s,"'}]+/gi,
      `$1${redacted}`,
    )
    .replace(/(sctapi\.ftqq\.com\/)[^/\s]+(\.send)/gi, `$1${redacted}$2`);
}

export function redactUrl(input: string): string {
  try {
    const url = new URL(input);
    if (url.username) url.username = redacted;
    if (url.password) url.password = redacted;
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveKey.test(key)) url.searchParams.set(key, redacted);
    }
    url.hash = redactText(url.hash);
    return url.toString();
  } catch {
    return redactText(input);
  }
}

export function redactSensitive<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactText(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (value instanceof Date) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = sensitiveKey.test(key) ? redacted : redactValue(item, seen);
  }
  return output;
}

export function sanitizeSignals(signals: readonly string[] | undefined): string[] {
  if (!signals) return [];
  return signals.slice(0, 20).map((signal) => redactText(signal).slice(0, 200));
}
