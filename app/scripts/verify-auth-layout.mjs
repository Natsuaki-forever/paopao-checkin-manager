import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const target = process.env.AUTH_LAYOUT_URL || process.argv[2] || "http://127.0.0.1:8787";
const mockAuth = process.env.AUTH_LAYOUT_MOCK === "1";
const screenshotDir = process.env.AUTH_LAYOUT_SCREENSHOT_DIR;
const viewports = [
  { name: "low-height-desktop", width: 2048, height: 560 },
  { name: "wide-short", width: 2048, height: 924 },
  { name: "desktop", width: 1920, height: 1080 },
  { name: "compact-desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const views = [
  { name: "user-login", open: async () => undefined },
  { name: "register", open: async (page) => page.getByRole("button", { name: "注册", exact: true }).click() },
  { name: "admin-login", open: async (page) => page.getByRole("button", { name: "管理员入口", exact: true }).click() },
];

function fail(message, details) {
  throw new Error(`${message}\n${JSON.stringify(details, null, 2)}`);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    for (const view of views) {
      const page = await browser.newPage({ viewport });
      if (mockAuth) {
        await page.route("**/api/auth/status", (route) => route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            requiresSetup: false,
            authenticated: false,
            mode: "simulation",
            registrationEnabled: true,
            registrationMode: "invite",
          }),
        }));
      }
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await page.goto(target, { waitUntil: "networkidle" });
      await page.locator(".auth-page").waitFor();
      await view.open(page);
      await page.waitForTimeout(100);

      const geometry = await page.evaluate(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) return null;
          const value = element.getBoundingClientRect();
          return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
        };
        const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
        const pageRect = rect(".auth-page");
        const content = rect(".auth-content");
        const card = rect(".auth-card");
        const visual = rect(".auth-visual");
        const toolbar = rect(".auth-toolbar");
        const theme = rect(".auth-theme-toggle");
        const footer = rect(".auth-attribution");
        const rootColumns = getComputedStyle(document.querySelector(".auth-page")).gridTemplateColumns;
        return {
          viewport: { width: innerWidth, height: innerHeight },
          document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
          rootColumns,
          pageRect,
          content,
          card,
          visual,
          toolbar,
          theme,
          footer,
          themeOverlapsCard: overlaps(theme, card),
          footerOverlapsCard: overlaps(footer, card),
          visualOverlapsCard: visual ? overlaps(visual, card) : false,
        };
      });

      const tolerance = 1;
      const horizontalOverflow = geometry.document.scrollWidth > geometry.document.clientWidth + tolerance;
      const rootHasMultipleColumns = geometry.rootColumns.trim().split(/\s+/).length !== 1;
      const outsideViewport = [geometry.card, geometry.theme, geometry.footer]
        .filter(Boolean)
        .some((box) => box.left < -tolerance || box.right > geometry.viewport.width + tolerance);
      if (horizontalOverflow || rootHasMultipleColumns || outsideViewport || geometry.themeOverlapsCard || geometry.footerOverlapsCard || geometry.visualOverlapsCard || consoleErrors.length) {
        fail(`认证页布局检查失败：${viewport.name}/${view.name}`, { geometry, consoleErrors });
      }
      if (screenshotDir) {
        await mkdir(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, `${viewport.name}-${view.name}.png`), fullPage: true });
      }
      console.log(`PASS ${viewport.name}/${view.name} scrollHeight=${geometry.document.scrollHeight}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
