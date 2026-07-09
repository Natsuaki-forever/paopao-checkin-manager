import cron from "node-cron";
import { loadConfig } from "./config.js";
import { runCheckin } from "./run.js";

const config = loadConfig();

if (!cron.validate(config.cronExpression)) {
  throw new Error(`无效的 CRON_EXPRESSION：${config.cronExpression}`);
}

console.log(
  `签到调度器已启动：${config.cronExpression} (${config.timezone})`,
);

let running = false;
cron.schedule(
  config.cronExpression,
  async () => {
    if (running) {
      console.warn("上一次签到任务仍在运行，本次跳过");
      return;
    }
    running = true;
    try {
      const result = await runCheckin(config);
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error("调度任务异常：", error);
    } finally {
      running = false;
    }
  },
  { timezone: config.timezone },
);
