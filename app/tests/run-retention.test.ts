import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/server/database.js";
import { cleanupRunArtifacts, getStorageUsage } from "../src/server/services/run-retention.js";

describe("run artifact retention", () => {
  let directory = "";
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("deletes expired orphan screenshots and keeps current files", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "checkin-retention-"));
    const screenshots = path.join(directory, "screenshots");
    await mkdir(screenshots);
    const expired = path.join(screenshots, "failure-expired.png");
    const current = path.join(screenshots, "failure-current.png");
    const unrelated = path.join(screenshots, "keep.txt");
    await Promise.all([writeFile(expired, "old"), writeFile(current, "new"), writeFile(unrelated, "old")]);
    const oldDate = new Date(Date.now() - 40 * 86_400_000);
    await Promise.all([utimes(expired, oldDate, oldDate), utimes(unrelated, oldDate, oldDate)]);
    const database = new AppDatabase(path.join(directory, "retention.sqlite"), randomBytes(32));

    const result = await cleanupRunArtifacts(database, screenshots);

    expect(result.removedScreenshots).toBe(1);
    await expect(stat(expired)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(current)).resolves.toBeTruthy();
    await expect(stat(unrelated)).resolves.toBeTruthy();
    database.close();
  });

  it("removes oldest screenshots when the size limit is exceeded", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "checkin-retention-size-"));
    const screenshots = path.join(directory, "screenshots");
    await mkdir(screenshots);
    const oldest = path.join(screenshots, "failure-oldest.png");
    const newest = path.join(screenshots, "failure-newest.png");
    await Promise.all([
      writeFile(oldest, Buffer.alloc(700 * 1024)),
      writeFile(newest, Buffer.alloc(700 * 1024)),
    ]);
    const oldDate = new Date(Date.now() - 2 * 86_400_000);
    await utimes(oldest, oldDate, oldDate);
    const database = new AppDatabase(path.join(directory, "retention.sqlite"), randomBytes(32));
    database.db.prepare("UPDATE system_settings SET screenshot_max_mb = 1 WHERE id = 1").run();

    const result = await cleanupRunArtifacts(database, screenshots);
    const usage = await getStorageUsage(database, screenshots);

    expect(result.removedScreenshots).toBe(1);
    await expect(stat(oldest)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(newest)).resolves.toBeTruthy();
    expect(usage).toMatchObject({ screenshotCount: 1, screenshotBytes: 700 * 1024 });
    database.close();
  });
});
