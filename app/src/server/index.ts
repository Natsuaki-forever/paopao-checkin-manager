import { mkdir } from "node:fs/promises";
import { buildApp } from "./app.js";
import { BrowserFormAdapter } from "./adapters/browser-form.js";
import { HttpFlowAdapter } from "./adapters/http-flow.js";
import { AdapterRegistry } from "./adapters/registry.js";
import { loadAppConfig } from "./config.js";
import { getOrCreateEncryptionKey } from "./crypto.js";
import { AppDatabase } from "./database.js";
import { TaskSessionRepository } from "./repositories/task-session.js";
import { NotificationService } from "./services/notifier.js";
import { CheckinRunEngine } from "./services/run-engine.js";
import { RunQueue } from "./services/run-queue.js";
import { startSimulationScheduler } from "./services/scheduler.js";
import { ManualLoginService } from "./services/manual-login.js";
import { cleanupRunArtifacts } from "./services/run-retention.js";

async function main(): Promise<void> {
  const config = loadAppConfig();
  const key = await getOrCreateEncryptionKey(config.secretPath);
  await mkdir(config.screenshotDir, { recursive: true, mode: 0o700 });
  const database = new AppDatabase(
    config.databasePath,
    key,
    config.mode === "simulation",
  );
  await cleanupRunArtifacts(database, config.screenshotDir);
  const notifier = new NotificationService(
    database,
    config.mode === "simulation",
  );
  const sessions = new TaskSessionRepository(database.db, database.key);
  const adapters =
    config.mode === "production"
      ? new AdapterRegistry([
          new BrowserFormAdapter(config.legacyModulePath, config.screenshotDir),
          new HttpFlowAdapter(),
        ])
      : undefined;
  const engine = new CheckinRunEngine(
    database,
    config.mode,
    adapters,
    notifier,
    config.features?.session ? sessions : undefined,
  );
  const manualLogin = config.mode === "production"
    ? new ManualLoginService(database, sessions, engine)
    : undefined;
  const queue = config.features?.queue ? new RunQueue(database, engine) : undefined;
  queue?.start();
  const stopScheduler = startSimulationScheduler(
    database,
    engine,
    queue,
    notifier,
    config.screenshotDir,
  );
  const app = await buildApp(config, database, engine, notifier, queue, sessions, manualLogin);

  app.addHook("onClose", async () => {
    stopScheduler();
    await queue?.stop();
    await manualLogin?.close();
    database.close();
  });

  await app.listen({ host: config.host, port: config.port });
  console.log(`炮炮签到站已启动：http://${config.host}:${config.port}`);
  console.log(
    config.mode === "production"
      ? "当前为正式模式，将执行已配置的网页登录模板与通知"
      : "当前为模拟模式，不会访问外部网站或发送通知",
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
