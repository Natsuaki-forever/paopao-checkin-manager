import cron from "node-cron";
import type { AppDatabase } from "../database.js";
import type { CheckinRunEngine } from "./run-engine.js";
import type { RunQueue } from "./run-queue.js";
import type { NotificationService } from "./notifier.js";
import { cleanupRunArtifacts } from "./run-retention.js";
import { zonedMinute } from "./next-run.js";

export interface ZonedTime {
  date: string;
  time: string;
}

export function zonedTime(date: Date, timezone: string): ZonedTime {
  return zonedMinute(date, timezone);
}

export function startSimulationScheduler(
  database: AppDatabase,
  engine: CheckinRunEngine,
  queue?: RunQueue,
  notifier?: NotificationService,
  screenshotDir?: string,
): () => void {
  const task = cron.schedule("* * * * *", () => {
    const current = new Date();
    void runScheduledTasks(database, engine, current, queue, screenshotDir).then(async () => {
      if (notifier && current.getHours() === 23 && current.getMinutes() === 59) {
        await notifier.sendDailySummary(current.toISOString().slice(0, 10));
      }
    }).catch((error) => {
      if (engine.activeRuns === 0) console.error("模拟调度失败", error);
    });
  });
  return () => task.stop();
}

export async function runScheduledTasks(
  database: AppDatabase,
  engine: CheckinRunEngine,
  date: Date,
  queue?: RunQueue,
  screenshotDir?: string,
): Promise<void> {
  if (screenshotDir) await cleanupRunArtifacts(database, screenshotDir);
  else database.cleanupRuns();
  for (const item of database.listTasks()) {
    if (!item.enabled) continue;
    const current = zonedTime(date, item.timezone);
    if (current.time !== item.scheduleTime) continue;
    const key = `${item.id}:${current.date}:${item.scheduleTime}`;
    try {
      if (queue) {
        queue.enqueue(item.id, "scheduled", key);
      } else {
          await engine.runTask(item.id, "scheduled", key);
      }
    } catch (error) {
      if (engine.activeRuns > 0) return;
      throw error;
    }
  }
}
