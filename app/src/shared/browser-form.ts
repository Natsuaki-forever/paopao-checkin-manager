import type { BrowserFormTemplateConfig } from "./types.js";

export const defaultBrowserFormTemplateConfig: BrowserFormTemplateConfig = {
  version: 1,
  loginButtonTexts: ["登录", "登入", "Login", "Sign in", "继续"],
  checkinButtonTexts: [
    "立即签到",
    "每日签到",
    "点击签到",
    "签到",
    "打卡",
    "领取",
    "Check in",
    "Claim",
  ],
  successTexts: [
    "签到成功",
    "打卡成功",
    "领取成功",
    "今日已签到",
    "今天已签到",
    "已完成签到",
    "Check-in successful",
    "Claimed",
  ],
  alreadyCheckedTexts: [
    "今日已签到",
    "今天已签到",
    "已完成签到",
    "Already checked in",
    "Already claimed",
  ],
};

function cleanSelector(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned || undefined;
}

function cleanTexts(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const unique = new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return unique.size > 0 ? [...unique] : [...fallback];
}

export function normalizeBrowserFormTemplateConfig(
  value: Partial<BrowserFormTemplateConfig> | undefined,
): BrowserFormTemplateConfig {
  return {
    version: 1,
    usernameSelector: cleanSelector(value?.usernameSelector),
    passwordSelector: cleanSelector(value?.passwordSelector),
    loginButtonSelector: cleanSelector(value?.loginButtonSelector),
    loginSuccessSelector: cleanSelector(value?.loginSuccessSelector),
    loginSuccessUrlIncludes: cleanSelector(value?.loginSuccessUrlIncludes),
    checkinButtonSelector: cleanSelector(value?.checkinButtonSelector),
    loginButtonTexts: cleanTexts(
      value?.loginButtonTexts,
      defaultBrowserFormTemplateConfig.loginButtonTexts || [],
    ),
    checkinButtonTexts: cleanTexts(
      value?.checkinButtonTexts,
      defaultBrowserFormTemplateConfig.checkinButtonTexts || [],
    ),
    successTexts: cleanTexts(
      value?.successTexts,
      defaultBrowserFormTemplateConfig.successTexts || [],
    ),
    alreadyCheckedTexts: cleanTexts(
      value?.alreadyCheckedTexts,
      defaultBrowserFormTemplateConfig.alreadyCheckedTexts || [],
    ),
  };
}