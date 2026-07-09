import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { StorageUsage } from "../../shared/types.js";
import type { AppDatabase } from "../database.js";

export interface CleanupResult {
  removedRuns: number;
  removedScreenshots: number;
  removedJobs: number;
  removedTokens: number;
  removedAuditEvents: number;
}

export async function cleanupRunArtifacts(
  database: AppDatabase,
  screenshotDir: string,
): Promise<CleanupResult> {
  const settings = database.getSettings();
  const cutoffTime = Date.now() - settings.retentionDays * 86_400_000;
  const cutoff = new Date(cutoffTime).toISOString();
  const referenced = database.db.prepare(`SELECT screenshot_path FROM runs
    WHERE finished_at < ? AND screenshot_path IS NOT NULL`).all(cutoff) as Array<{
      screenshot_path: string;
    }>;
  const root = path.resolve(screenshotDir);
  const expiredReferences = new Set(
    referenced
      .map((row) => path.resolve(row.screenshot_path))
      .filter((value) => path.dirname(value) === root),
  );
  const removedRuns = database.cleanupRuns();
  let removedScreenshots = 0;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const remaining: Array<{ path: string; size: number; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^failure-[\w.-]+\.png$/.test(entry.name)) continue;
    const filePath = path.join(root, entry.name);
    const file = await stat(filePath).catch(() => undefined);
    if (!file) continue;
    if (expiredReferences.has(filePath) || file.mtimeMs < cutoffTime) {
      if (await deleteScreenshot(database, filePath)) removedScreenshots += 1;
      continue;
    }
    remaining.push({ path: filePath, size: file.size, mtimeMs: file.mtimeMs });
  }
  let totalBytes = remaining.reduce((sum, file) => sum + file.size, 0);
  const maximumBytes = settings.screenshotMaxMb * 1024 * 1024;
  remaining.sort((left, right) => left.mtimeMs - right.mtimeMs);
  for (const file of remaining) {
    if (totalBytes <= maximumBytes) break;
    if (await deleteScreenshot(database, file.path)) {
      totalBytes -= file.size;
      removedScreenshots += 1;
    }
  }
  const removedJobs = database.db.prepare(`DELETE FROM run_jobs
    WHERE status IN ('succeeded', 'failed', 'cancelled')
      AND COALESCE(finished_at, queued_at) < ?`).run(cutoff).changes;
  const removedTokens = database.db.prepare(`DELETE FROM manual_session_tokens
    WHERE expires_at <= ? OR used_at IS NOT NULL`).run(new Date().toISOString()).changes;
  database.db.prepare(`DELETE FROM password_reset_tokens
    WHERE expires_at <= ? OR used_at IS NOT NULL`).run(new Date().toISOString());
  database.db.prepare("DELETE FROM usage_counters WHERE usage_date < ?")
    .run(new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10));
  const auditCutoff = new Date(Date.now() - settings.auditRetentionDays * 86_400_000).toISOString();
  const removedAuditEvents = database.db.prepare("DELETE FROM audit_events WHERE created_at < ?")
    .run(auditCutoff).changes;
  return { removedRuns, removedScreenshots, removedJobs, removedTokens, removedAuditEvents };
}

export async function getStorageUsage(
  database: AppDatabase,
  screenshotDir: string,
): Promise<StorageUsage> {
  const entries = await readdir(screenshotDir, { withFileTypes: true }).catch(() => []);
  let screenshotCount = 0;
  let screenshotBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^failure-[\w.-]+\.png$/.test(entry.name)) continue;
    const file = await stat(path.join(screenshotDir, entry.name)).catch(() => undefined);
    if (!file) continue;
    screenshotCount += 1;
    screenshotBytes += file.size;
  }
  const databaseName = database.db.name;
  let databaseBytes = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    databaseBytes += (await stat(databaseName + suffix).catch(() => undefined))?.size || 0;
  }
  const runRecords = (database.db.prepare("SELECT COUNT(*) AS count FROM runs").get() as { count: number }).count;
  const completedJobs = (database.db.prepare(`SELECT COUNT(*) AS count FROM run_jobs
    WHERE status IN ('succeeded', 'failed', 'cancelled')`).get() as { count: number }).count;
  return {
    screenshotCount,
    screenshotBytes,
    screenshotMaxBytes: database.getSettings().screenshotMaxMb * 1024 * 1024,
    databaseBytes,
    managedBytes: screenshotBytes + databaseBytes,
    runRecords,
    completedJobs,
  };
}

async function deleteScreenshot(database: AppDatabase, filePath: string): Promise<boolean> {
  const deleted = await unlink(filePath).then(() => true).catch(() => false);
  if (deleted) {
    database.db.prepare("UPDATE runs SET screenshot_path = NULL WHERE screenshot_path = ?").run(filePath);
  }
  return deleted;
}
