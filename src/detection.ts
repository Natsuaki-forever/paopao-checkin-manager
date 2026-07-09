import type { Locator, Page } from "playwright";
import { PageChangedError } from "./errors.js";
import type { AppConfig } from "./types.js";

async function hasVisibleSelector(
  page: Page,
  selectors: string[],
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      if (await page.locator(selector).first().isVisible()) return true;
    } catch {
      // Invalid or stale selectors are ignored; other signals remain available.
    }
  }
  return false;
}

export function textPattern(texts: string[], exact = false): RegExp {
  if (texts.length === 0) return /(?!)/;
  const escaped = texts.map((text) =>
    text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const source = exact
    ? "^(?:" + escaped.join("|") + ")$"
    : "(?:" + escaped.join("|") + ")";
  return new RegExp(source, "i");
}

export async function pageContainsText(
  page: Page,
  texts: string[],
): Promise<boolean> {
  if (texts.length === 0) return false;
  try {
    return await page
      .getByText(textPattern(texts), { exact: false })
      .first()
      .isVisible();
  } catch {
    return false;
  }
}

export async function detectChallenge(
  page: Page,
  config: AppConfig,
): Promise<boolean> {
  return (
    (await hasVisibleSelector(page, config.challengeSelectors)) ||
    (await pageContainsText(page, config.challengeTexts))
  );
}

export async function detectAlreadyChecked(
  page: Page,
  config: AppConfig,
): Promise<boolean> {
  return (
    (await hasVisibleSelector(page, config.alreadyCheckedSelectors)) ||
    (await pageContainsText(page, config.alreadyCheckedTexts))
  );
}

async function uniqueUsable(
  locator: Locator,
  label: string,
): Promise<Locator | undefined> {
  const count = Math.min(await locator.count().catch(() => 0), 20);
  let found: Locator | undefined;
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const usable =
      (await candidate.isVisible().catch(() => false)) &&
      (await candidate.isEnabled().catch(() => false));
    if (!usable) continue;
    if (found) {
      throw new PageChangedError(
        "检测到多个可用的" + label + "，为避免误操作已停止",
      );
    }
    found = candidate;
  }
  return found;
}

async function findCheckinByAccessibleAttributes(
  page: Page,
  configuredTexts: string[],
): Promise<Locator | undefined> {
  const candidates = page.locator('[alt], [title], [aria-label]');
  const count = Math.min(await candidates.count().catch(() => 0), 100);
  const exactText = textPattern(configuredTexts, true);
  const strongMarker = /(?:签到|打卡|check[\s_-]*in|daily[\s_-]*sign|qiandao)/i;
  let found: Locator | undefined;
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const values = await Promise.all([
      candidate.getAttribute("alt"),
      candidate.getAttribute("title"),
      candidate.getAttribute("aria-label"),
    ]);
    const matches = values.some((value) => {
      const normalized = value?.replace(/\s+/g, " ").trim() || "";
      return normalized && (exactText.test(normalized) || strongMarker.test(normalized));
    });
    if (!matches || !(await candidate.isVisible().catch(() => false)) ||
      !(await candidate.isEnabled().catch(() => false))) continue;
    if (found) throw new PageChangedError("检测到多个属性类签到入口，为避免误操作已停止");
    found = candidate;
  }
  return found;
}

const checkinMarkerSelector = [
  'a[href*="checkin" i]',
  'a[href*="check-in" i]',
  'a[href*="check_in" i]',
  'a[href*="qiandao" i]',
  'a[href*="daily-sign" i]',
  'a[href*="daily_sign" i]',
  'a[href*="claim" i]',
  'button[id*="checkin" i]',
  'button[class*="checkin" i]',
  'button[id*="qiandao" i]',
  'button[class*="qiandao" i]',
  '[role="button"][id*="checkin" i]',
  '[role="button"][class*="checkin" i]',
  'img[id*="checkin" i]',
  'img[class*="checkin" i]',
  'img[src*="checkin" i]',
  'img[id*="qiandao" i]',
  'img[src*="qiandao" i]',
  'input[type="button"][id*="checkin" i]',
  'input[type="submit"][id*="checkin" i]',
].join(", ");

export async function findCheckinButton(
  page: Page,
  config: AppConfig,
): Promise<Locator | undefined> {
  for (const selector of config.checkinButtonSelectors) {
    try {
      const candidate = await uniqueUsable(
        page.locator(selector),
        "签到按钮",
      );
      if (candidate) return candidate;
    } catch (error) {
      if (error instanceof PageChangedError) throw error;
      // Invalid optional selectors fall through to text recognition.
    }
  }

  const pattern = textPattern(config.checkinButtonTexts, true);
  const roleButton = await uniqueUsable(
    page.getByRole("button", { name: pattern }),
    "签到按钮",
  );
  if (roleButton) return roleButton;

  const textEntry = await uniqueUsable(
    page.locator('button, [role="button"], a').filter({ hasText: pattern }),
    "签到入口",
  );
  if (textEntry) return textEntry;

  const attributed = await findCheckinByAccessibleAttributes(
    page,
    config.checkinButtonTexts,
  );
  if (attributed) return attributed;

  return uniqueUsable(page.locator(checkinMarkerSelector), "签到属性入口");
}

export async function detectSuccess(
  page: Page,
  config: AppConfig,
  clickedButton: Locator,
): Promise<boolean> {
  if (await hasVisibleSelector(page, config.successSelectors)) return true;
  if (await pageContainsText(page, config.successTexts)) return true;
  if (!(await clickedButton.isEnabled().catch(() => true))) return true;
  return detectAlreadyChecked(page, config);
}
