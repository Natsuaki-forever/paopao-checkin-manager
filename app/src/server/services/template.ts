import type { RunRecord, TemplateStatus } from "../../shared/types.js";
import { templateVariables } from "../../shared/types.js";

const allowed = new Set<string>(templateVariables);
const variablePattern = /{{\s*([A-Za-z0-9_]+)\s*}}/g;

export function validateTemplate(content: string): void {
  const badRequest = (message: string) =>
    Object.assign(new Error(message), { statusCode: 400 });
  if (!content.trim()) throw badRequest("通知模板不能为空");
  if (content.length > 2_000) throw badRequest("通知模板不能超过 2000 个字符");
  for (const match of content.matchAll(variablePattern)) {
    if (!allowed.has(match[1] || "")) {
      throw badRequest(`不支持的模板变量：${match[1]}`);
    }
  }
}

export function renderTemplate(
  content: string,
  data: Record<(typeof templateVariables)[number], string>,
): string {
  validateTemplate(content);
  return content.replace(variablePattern, (_match, name: string) => data[name as keyof typeof data] || "");
}

export function templateStatus(status: RunRecord["status"]): TemplateStatus {
  if (status === "success" || status === "already_checked") return status;
  return "failure";
}

export const sampleTemplateData = {
  siteName: "Lynvx",
  status: "签到成功",
  message: "模拟签到成功，未访问目标网站",
  finishedAt: "2026-06-29 08:00:12",
  duration: "1.23 秒",
};
