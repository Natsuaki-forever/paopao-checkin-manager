import {
  appendFile,
  mkdir,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { RunResult } from "./types.js";

export async function ensureRuntimeDirectories(cwd = process.cwd()): Promise<void> {
  await Promise.all([
    mkdir(path.resolve(cwd, "data"), { recursive: true, mode: 0o700 }),
    mkdir(path.resolve(cwd, "logs"), { recursive: true, mode: 0o700 }),
    mkdir(path.resolve(cwd, "screenshots"), { recursive: true, mode: 0o700 }),
  ]);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function appendRunLog(
  logPath: string,
  result: RunResult,
): Promise<void> {
  await appendFile(logPath, `${JSON.stringify(result)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const staleAfterMs = 30 * 60 * 1_000;

  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs > staleAfterMs) {
      await rm(lockPath, { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    );
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

    const statText = await readFile(lockPath, "utf8").catch(() => "");
    throw new Error(`已有签到任务正在运行。锁信息：${statText || "未知"}`);
  }

  return async () => {
    await rm(lockPath, { force: true });
  };
}

export async function writePrivateFile(
  filePath: string,
  content: string,
): Promise<void> {
  await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
}
