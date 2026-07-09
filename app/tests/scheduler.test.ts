import { describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "../src/server/database.js";
import type { CheckinRunEngine } from "../src/server/services/run-engine.js";
import type { RunQueue } from "../src/server/services/run-queue.js";
import { runScheduledTasks, zonedTime } from "../src/server/services/scheduler.js";

describe("scheduler timezone", () => {
  it("formats the same instant in Asia/Shanghai", () => {
    expect(zonedTime(new Date("2026-06-29T00:30:00.000Z"), "Asia/Shanghai")).toEqual({
      date: "2026-06-29",
      time: "08:30",
    });
  });

  it("enqueues due tasks when the queue rollout is enabled", async () => {
    const database = {
      cleanupRuns: vi.fn(),
      listTasks: vi.fn(() => [{
        id: "task-id",
        enabled: true,
        timezone: "Asia/Shanghai",
        scheduleTime: "08:30",
      }]),
    } as unknown as AppDatabase;
    const engine = { activeRuns: 0, runTask: vi.fn() } as unknown as CheckinRunEngine;
    const queue = { enqueue: vi.fn() } as unknown as RunQueue;

    await runScheduledTasks(
      database,
      engine,
      new Date("2026-06-29T00:30:00.000Z"),
      queue,
    );

    expect(queue.enqueue).toHaveBeenCalledWith(
      "task-id",
      "scheduled",
      "task-id:2026-06-29:08:30",
    );
    expect(engine.runTask).not.toHaveBeenCalled();
  });
});
