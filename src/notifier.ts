import type { AppConfig, RunResult } from "./types.js";

function safeMessage(message: string): string {
  return message.replace(/\s+/g, " ").slice(0, 500);
}

function notificationTitle(result: RunResult): string {
  if (result.status === "success") return "自动签到成功";
  if (result.status === "already_checked") return "今日已签到";
  return `自动签到失败：${result.status}`;
}

export function buildWechatPayload(result: RunResult, targetUrl: string): object {
  const successful =
    result.status === "success" || result.status === "already_checked";
  const lines = [
    `### ${notificationTitle(result)}`,
    `> 状态：<font color="${successful ? "info" : "warning"}">${result.status}</font>`,
    `> 结果：${safeMessage(result.message)}`,
    `> 时间：${result.finishedAt}`,
    `> 尝试次数：${result.attempt}`,
    `> 目标：${targetUrl}`,
  ];

  return {
    msgtype: "markdown",
    markdown: { content: lines.join("\n") },
  };
}

export function buildServerChanPayload(
  result: RunResult,
  targetUrl: string,
): URLSearchParams {
  return new URLSearchParams({
    title: notificationTitle(result),
    desp: [
      `状态：${result.status}`,
      `结果：${safeMessage(result.message)}`,
      `时间：${result.finishedAt}`,
      `尝试次数：${result.attempt}`,
      `目标：${targetUrl}`,
    ].join("\n\n"),
  });
}

async function notifyWechat(
  webhookUrl: string,
  result: RunResult,
  targetUrl: string,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildWechatPayload(result, targetUrl)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`企业微信通知失败：HTTP ${response.status}`);
  }
  const body = (await response.json()) as { errcode?: number; errmsg?: string };
  if (body.errcode !== 0) {
    throw new Error(
      `企业微信通知失败：${body.errcode ?? "unknown"} ${body.errmsg ?? ""}`,
    );
  }
}

async function notifyServerChan(
  sendKey: string,
  result: RunResult,
  targetUrl: string,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(sendKey)) {
    throw new Error("Server酱 SendKey 格式无效");
  }
  const response = await fetch(`https://sctapi.ftqq.com/${sendKey}.send`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: buildServerChanPayload(result, targetUrl),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Server酱通知失败：HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    code?: number;
    message?: string;
    data?: { errno?: number; errmsg?: string };
  };
  if (body.code !== 0 && body.data?.errno !== 0) {
    throw new Error(
      `Server酱通知失败：${body.message ?? body.data?.errmsg ?? "未知错误"}`,
    );
  }
}

export async function notifyResult(
  config: Pick<AppConfig, "wechatWebhookUrl" | "serverChanSendKey">,
  result: RunResult,
  targetUrl: string,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (config.wechatWebhookUrl) {
    tasks.push(notifyWechat(config.wechatWebhookUrl, result, targetUrl));
  }
  if (config.serverChanSendKey) {
    tasks.push(notifyServerChan(config.serverChanSendKey, result, targetUrl));
  }
  if (tasks.length === 0) return;

  const settled = await Promise.allSettled(tasks);
  const errors = settled
    .filter(
      (item): item is PromiseRejectedResult => item.status === "rejected",
    )
    .map((item) =>
      item.reason instanceof Error ? item.reason.message : String(item.reason),
    );
  if (errors.length > 0) throw new Error(errors.join("；"));
}
