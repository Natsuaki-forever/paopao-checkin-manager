import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { AppDatabase } from "../database.js";
import type { BrowserStorageState, TaskSessionRepository } from "../repositories/task-session.js";
import { assertSafeProxyUrl, assertSafeUrl, installBrowserRequestGuard } from "../security/network.js";
import type { CheckinRunEngine } from "./run-engine.js";
import type { ManualElementSelection } from "../../shared/types.js";

const VIEWPORT = { width: 1280, height: 800 } as const;
const LIFETIME_MS = 10 * 60_000;

export interface ManualLoginState {
  id: string;
  taskId: string;
  taskName: string;
  url: string;
  title: string;
  expiresAt: string;
  viewportWidth: number;
  viewportHeight: number;
}

interface ActiveSession {
  id: string;
  taskId: string;
  taskName: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  expiresAt: number;
  timer: NodeJS.Timeout;
  selection?: ManualElementSelection;
}

export class ManualLoginService {
  private active?: ActiveSession;

  constructor(
    private readonly database: AppDatabase,
    private readonly sessions: TaskSessionRepository,
    private readonly engine: CheckinRunEngine,
  ) {}

  async start(taskId: string): Promise<ManualLoginState> {
    if (this.active) throw conflict("已有人工登录会话，请先完成或取消");
    const task = this.database.getTask(taskId);
    if (!task) throw notFound("签到任务不存在");
    await assertSafeUrl(task.loginUrl);
    await assertSafeUrl(task.checkinUrl);
    if (!this.engine.beginManualLogin()) {
      throw conflict("当前有任务正在运行，请稍后再试");
    }

    let browser: Browser | undefined;
    try {
      const proxy = this.resolveProxy(taskId);
      if (proxy?.server) await assertSafeProxyUrl(proxy.server);
      browser = await chromium.launch({ headless: true, proxy });
      const storedState = this.sessions.getStatus(taskId).status === "valid"
        ? this.sessions.get(taskId)
        : undefined;
      const context = await browser.newContext({
        viewport: VIEWPORT,
        timezoneId: task.timezone,
        storageState: storedState,
      });
      await installBrowserRequestGuard(context);
      const page = await context.newPage();
      const settings = this.database.getSettings();
      page.setDefaultNavigationTimeout(settings.navigationTimeoutMs);
      page.setDefaultTimeout(settings.actionTimeoutMs);
      await page.goto(task.loginUrl, { waitUntil: "domcontentloaded" });

      const id = randomUUID();
      const expiresAt = Date.now() + LIFETIME_MS;
      const timer = setTimeout(() => void this.expire(id), LIFETIME_MS);
      timer.unref();
      this.active = { id, taskId, taskName: task.name, browser, context, page, expiresAt, timer };
      return await this.state(id);
    } catch (error) {
      await browser?.close().catch(() => undefined);
      this.engine.endManualLogin();
      throw error;
    }
  }

  async state(id: string): Promise<ManualLoginState> {
    const session = this.require(id);
    return {
      id: session.id,
      taskId: session.taskId,
      taskName: session.taskName,
      url: safeDisplayUrl(session.page.url()),
      title: (await session.page.title()).slice(0, 200),
      expiresAt: new Date(session.expiresAt).toISOString(),
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
    };
  }

  taskId(id: string): string {
    return this.require(id).taskId;
  }

  async closeForTaskIds(taskIds: Set<string>): Promise<void> {
    if (this.active && taskIds.has(this.active.taskId)) await this.close(this.active.id);
  }

  async screenshot(id: string): Promise<Buffer> {
    return await this.require(id).page.screenshot({ type: "png" });
  }

  async click(id: string, x: number, y: number): Promise<ManualLoginState> {
    const session = this.require(id);
    session.selection = undefined;
    await session.page.mouse.click(x, y);
    await session.page.waitForTimeout(250);
    return await this.state(id);
  }

  async inspectElement(id: string, x: number, y: number): Promise<ManualElementSelection> {
    const session = this.require(id);
    const selection = await session.page.evaluate(({ x, y }) => {
      const clicked = document.elementFromPoint(x, y);
      if (!(clicked instanceof Element)) return undefined;
      const clickable = clicked.closest(
        'button, a, [role="button"], input[type="button"], input[type="submit"]',
      );
      if (!clickable) return undefined;
      const nodes = clicked === clickable ? [clicked] : [clicked, clickable];
      const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      const unique = (selector: string) => {
        try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
      };
      const descriptor = (element: Element): {
        selector: string;
        strategy: "id" | "attribute" | "class" | "path";
      } | undefined => {
        const tag = element.tagName.toLowerCase();
        const id = element.getAttribute("id")?.trim();
        if (id) {
          const selector = `#${CSS.escape(id)}`;
          if (unique(selector)) return { selector, strategy: "id" };
        }
        for (const attribute of ["data-testid", "data-action", "name", "alt", "aria-label", "title"]) {
          const value = element.getAttribute(attribute)?.trim();
          if (!value || value.length > 120) continue;
          const selector = `${tag}[${attribute}=${quote(value)}]`;
          if (unique(selector)) return { selector, strategy: "attribute" };
        }
        const classes = [...element.classList]
          .filter((value) => /^[A-Za-z][\w-]{1,60}$/.test(value) && !/(active|selected|hover|focus|open)/i.test(value))
          .slice(0, 3);
        if (classes.length > 0) {
          const selector = tag + classes.map((value) => `.${CSS.escape(value)}`).join("");
          if (unique(selector)) return { selector, strategy: "class" };
        }
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && current !== document.body && parts.length < 6) {
          const currentTag = current.tagName.toLowerCase();
          const siblings = current.parentElement
            ? [...current.parentElement.children].filter((item) => item.tagName === current!.tagName)
            : [];
          const position = siblings.indexOf(current) + 1;
          parts.unshift(`${currentTag}:nth-of-type(${Math.max(1, position)})`);
          const selector = parts.join(" > ");
          if (unique(selector)) return { selector, strategy: "path" };
          current = current.parentElement;
        }
        return undefined;
      };
      for (const element of nodes) {
        const result = descriptor(element);
        if (!result) continue;
        const rect = element.getBoundingClientRect();
        const label = [
          element.getAttribute("alt"),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.textContent,
        ].find((value) => value?.trim())?.replace(/\s+/g, " ").trim().slice(0, 80) || element.tagName.toLowerCase();
        return {
          ...result,
          label,
          tag: element.tagName.toLowerCase(),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }
      return undefined;
    }, { x, y });
    if (!selection || selection.rect.width <= 0 || selection.rect.height <= 0) {
      throw badRequest("该位置没有可确认的按钮或链接，请点击签到入口本身");
    }
    const locator = session.page.locator(selection.selector);
    if (await locator.count() !== 1 || !(await locator.isVisible()) || !(await locator.isEnabled())) {
      throw badRequest("选中元素不唯一或当前不可用");
    }
    session.selection = selection;
    return selection;
  }

  confirmElement(id: string): ManualElementSelection {
    const session = this.require(id);
    if (!session.selection) throw badRequest("请先在画面中选择签到元素");
    this.database.setTaskCheckinSelector(session.taskId, session.selection.selector);
    return session.selection;
  }

  async type(id: string, text: string): Promise<ManualLoginState> {
    const session = this.require(id);
    await session.page.keyboard.type(text, { delay: 20 });
    return await this.state(id);
  }

  async key(id: string, key: string): Promise<ManualLoginState> {
    const session = this.require(id);
    await session.page.keyboard.press(key);
    await session.page.waitForTimeout(200);
    return await this.state(id);
  }

  async goToCheckin(id: string): Promise<ManualLoginState> {
    const session = this.require(id);
    const task = this.database.getTask(session.taskId);
    if (!task) throw notFound("签到任务不存在");
    await session.page.goto(task.checkinUrl, { waitUntil: "domcontentloaded" });
    return await this.state(id);
  }

  async save(id: string): Promise<void> {
    const session = this.require(id);
    const task = this.database.getTask(session.taskId);
    if (!task) throw notFound("签到任务不存在");
    const current = await assertSafeUrl(session.page.url());
    const allowedHosts = new Set([new URL(task.loginUrl).hostname, new URL(task.checkinUrl).hostname]);
    if (!allowedHosts.has(current.hostname)) {
      throw badRequest("当前页面不在任务站点域名下，不能保存会话");
    }
    const visiblePasswordFields = await session.page.locator('input[type="password"]:visible').count();
    if (visiblePasswordFields > 0) {
      throw badRequest("页面仍显示密码输入框，请先完成登录再保存");
    }
    this.sessions.save(session.taskId, await session.context.storageState() as BrowserStorageState);
    await this.close(id);
  }

  async close(id?: string): Promise<void> {
    if (!this.active || (id && this.active.id !== id)) return;
    const session = this.active;
    this.active = undefined;
    clearTimeout(session.timer);
    await session.browser.close().catch(() => undefined);
    this.engine.endManualLogin();
  }

  private require(id: string): ActiveSession {
    const session = this.active;
    if (!session || session.id !== id) throw notFound("人工登录会话不存在或已结束");
    if (session.expiresAt <= Date.now()) {
      void this.close(id);
      throw gone("人工登录会话已过期，请重新开始");
    }
    return session;
  }

  private async expire(id: string): Promise<void> {
    if (this.active?.id === id) await this.close(id);
  }

  private resolveProxy(taskId: string): { server: string; username?: string; password?: string } | undefined {
    const taskProxy = this.database.getTaskProxy(taskId);
    if (taskProxy?.mode === "direct") return undefined;
    const rawServer = taskProxy?.mode === "custom"
      ? taskProxy.server
      : this.database.getSettings().proxyServer || undefined;
    if (!rawServer) return undefined;
    const parsed = new URL(rawServer);
    const username = taskProxy?.mode === "custom" ? taskProxy.username : decodeURIComponent(parsed.username);
    const password = taskProxy?.mode === "custom" ? taskProxy.password : decodeURIComponent(parsed.password);
    parsed.username = "";
    parsed.password = "";
    return { server: parsed.toString(), username: username || undefined, password: password || undefined };
  }
}

function safeDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}
const badRequest = (message: string) => httpError(message, 400);
const notFound = (message: string) => httpError(message, 404);
const conflict = (message: string) => httpError(message, 409);
const gone = (message: string) => httpError(message, 410);
