export interface NextRunInfo {
  nextRun: string;
  nextRunAt?: string;
}

export interface ZonedMinute {
  date: string;
  time: string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timezone, created);
  return created;
}

export function zonedMinute(date: Date, timezone: string): ZonedMinute {
  const parts = formatter(timezone).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

export function nextRunInstant(
  scheduleTime: string,
  timezone: string,
  from = new Date(),
): Date | undefined {
  const start = new Date(from);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  // Three days covers DST gaps while using exactly the same wall-clock semantics
  // as the minute scheduler.
  for (let minute = 0; minute < 3 * 24 * 60; minute += 1) {
    const candidate = new Date(start.getTime() + minute * 60_000);
    if (zonedMinute(candidate, timezone).time === scheduleTime) return candidate;
  }
  return undefined;
}

export function nextRunInfo(
  scheduleTime: string,
  timezone: string,
  enabled: boolean,
  from = new Date(),
): NextRunInfo {
  if (!enabled) return { nextRun: "已停用" };
  const instant = nextRunInstant(scheduleTime, timezone, from);
  if (!instant) return { nextRun: "等待计划" };
  const currentDate = zonedMinute(from, timezone).date;
  const targetDate = zonedMinute(instant, timezone).date;
  const tomorrow = zonedMinute(new Date(from.getTime() + 24 * 60 * 60_000), timezone).date;
  const day = targetDate === currentDate ? "今天" : targetDate === tomorrow ? "明天" : targetDate;
  return { nextRun: `${day} ${scheduleTime}`, nextRunAt: instant.toISOString() };
}
