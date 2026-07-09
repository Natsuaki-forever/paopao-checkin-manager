import { describe, expect, it } from "vitest";
import { nextRunInfo, nextRunInstant } from "../src/server/services/next-run.js";

describe("next run calculation", () => {
  it("labels an upcoming task in its own timezone", () => {
    expect(nextRunInfo(
      "18:30",
      "Asia/Shanghai",
      true,
      new Date("2026-07-08T08:00:00.000Z"),
    )).toEqual({
      nextRun: "今天 18:30",
      nextRunAt: "2026-07-08T10:30:00.000Z",
    });
  });

  it("skips a nonexistent spring-forward wall clock minute", () => {
    expect(nextRunInstant(
      "02:30",
      "America/New_York",
      new Date("2026-03-08T06:55:00.000Z"),
    )?.toISOString()).toBe("2026-03-09T06:30:00.000Z");
  });

  it("finds the second repeated minute during fall-back", () => {
    expect(nextRunInstant(
      "01:30",
      "America/New_York",
      new Date("2026-11-01T05:31:00.000Z"),
    )?.toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });

  it("does not schedule disabled tasks", () => {
    expect(nextRunInfo("08:00", "Asia/Shanghai", false)).toEqual({ nextRun: "已停用" });
  });
});
