import { loadConfig } from "./config.js";
import { runCheckin } from "./run.js";

const result = await runCheckin(loadConfig());
console.log(JSON.stringify(result, null, 2));

if (!["success", "already_checked"].includes(result.status)) {
  process.exitCode = 1;
}
