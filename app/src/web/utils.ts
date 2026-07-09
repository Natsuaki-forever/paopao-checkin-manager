import type { RunStatus } from "../shared/types";

export const statusLabels: Record<RunStatus, string> = {
  success: "签到成功",
  already_checked: "已签到",
  auth_required: "登录失败",
  challenge: "需要验证",
  page_changed: "页面变化",
  session_expired: "会话失效",
  proxy_failure: "代理失败",
  cancelled: "已取消",
  failure: "失败",
};

export const runStatusText = (status: RunStatus): string => statusLabels[status];

export function statusTone(
  status: RunStatus,
): "success" | "warning" | "danger" {
  if (status === "success") return "success";
  if (status === "failure" || status === "proxy_failure" || status === "auth_required") return "danger";
  return "warning";
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date(value))
    .replaceAll("/", "-");
}

export function formatDuration(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${milliseconds} 毫秒`
    : `${(milliseconds / 1_000).toFixed(2)} 秒`;
}
