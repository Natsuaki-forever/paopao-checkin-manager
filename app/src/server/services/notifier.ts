import type {
  NotificationChannel,
  RunRecord,
  TaskSummary,
} from "../../shared/types.js";
import type { AppDatabase } from "../database.js";
import { decryptSecret } from "../crypto.js";
import {
  renderTemplate,
  sampleTemplateData,
  templateStatus,
} from "./template.js";

interface ChannelRow {
  enabled: number;
  secret_cipher: string | null;
}

export class NotificationService {
  constructor(
    private readonly database: AppDatabase,
    private readonly simulated: boolean,
  ) {}

  async sendForRun(
    task: TaskSummary,
    run: RunRecord,
  ): Promise<"sent" | "simulated" | "skipped" | "failed"> {
    const ownerUserId = task.ownerUserId || null;
    const policy = this.database.getNotificationPolicy(task.id);
    const succeeded = run.status === "success" || run.status === "already_checked";
    if ((run.trigger === "manual" && !policy.manual) ||
      (run.trigger === "scheduled" && !policy.scheduled) ||
      (succeeded && !policy.success) || (!succeeded && !policy.failure) ||
      (!succeeded && (policy.consecutiveFailures || 0) < policy.failureThreshold)) {
      return "skipped";
    }
    const channels: NotificationChannel[] = [];
    if (task.notifyServerChan) channels.push("serverchan");
    if (task.notifyWechat) channels.push("wechat");
    for (const channel of ["bark", "telegram", "webhook"] as NotificationChannel[]) {
      const row = this.getChannel(channel, ownerUserId);
      if (row.enabled && row.secret_cipher) channels.push(channel);
    }
    if (channels.length === 0) return "skipped";
    if (this.simulated) return "simulated";
    const activeChannels = channels.filter((channel) => {
      const row = this.getChannel(channel, ownerUserId);
      return Boolean(row.enabled && row.secret_cipher);
    });
    if (activeChannels.length === 0) return "skipped";

    const data = {
      siteName: task.name,
      status: statusText(run.status),
      message: run.message.replace(/\s+/g, " ").slice(0, 500),
      finishedAt: run.finishedAt,
      duration: `${(run.durationMs / 1_000).toFixed(2)} 秒`,
    };
    const results = await Promise.allSettled(
      activeChannels.map(async (channel) => {
        const row = this.getChannel(channel, ownerUserId);
        const secret = decryptSecret(row.secret_cipher!, this.database.key);
        const template = this.database.db
          .prepare(
            `SELECT content FROM notification_templates WHERE channel = ? AND status = ?
              AND ${ownerUserId ? "owner_user_id = ?" : "owner_user_id IS NULL"}`,
          )
          .get(...(ownerUserId
            ? [channel, templateStatus(run.status), ownerUserId]
            : [channel, templateStatus(run.status)])) as { content: string };
        const content = renderTemplate(template.content, data);
        await this.send(channel, secret, content, `${task.name} ${statusText(run.status)}`);
      }),
    );
    return results.some((result) => result.status === "rejected")
      ? "failed"
      : "sent";
  }

  async sendTest(channel: NotificationChannel, ownerUserId: string | null = null): Promise<string> {
    if (this.simulated) {
      return `${channelName(channel)}模拟测试成功，未发送外部请求`;
    }
    const row = this.getChannel(channel, ownerUserId);
    if (!row.enabled) throw Object.assign(new Error("请先启用该通知渠道"), { statusCode: 400 });
    if (!row.secret_cipher) throw Object.assign(new Error("请先保存通知密钥"), { statusCode: 400 });
    const secret = decryptSecret(row.secret_cipher, this.database.key);
    const template = this.database.db
      .prepare(
        `SELECT content FROM notification_templates WHERE channel = ? AND status = 'success'
          AND ${ownerUserId ? "owner_user_id = ?" : "owner_user_id IS NULL"}`,
      )
      .get(...(ownerUserId ? [channel, ownerUserId] : [channel])) as { content: string };
    const content = renderTemplate(template.content, sampleTemplateData);
    await this.send(channel, secret, content, "签到管理通知测试");
    return `${channelName(channel)}测试消息发送成功`;
  }

  async sendDailySummary(date: string): Promise<void> {
    const owners = this.database.db.prepare("SELECT DISTINCT owner_user_id FROM tasks")
      .all() as Array<{ owner_user_id: string | null }>;
    for (const { owner_user_id } of owners) await this.sendDailySummaryForOwner(date, owner_user_id);
  }

  private async sendDailySummaryForOwner(date: string, ownerUserId: string | null): Promise<void> {
    const alreadySent = ownerUserId
      ? this.database.db.prepare("SELECT 1 FROM daily_summary_log WHERE owner_user_id = ? AND summary_date = ?").get(ownerUserId, date)
      : this.database.db.prepare("SELECT 1 FROM daily_summary_log WHERE owner_user_id IS NULL AND summary_date = ?").get(date);
    if (alreadySent) return;
    const counts = this.database.db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status IN ('success','already_checked') THEN 1 ELSE 0 END) AS succeeded
      FROM runs WHERE finished_at >= ? AND finished_at < ?
      AND ${ownerUserId ? "owner_user_id = ?" : "owner_user_id IS NULL"}`).get(
        ...[
          `${date}T00:00:00.000Z`,
          `${date}T23:59:59.999Z`,
          ...(ownerUserId ? [ownerUserId] : []),
        ],
      ) as { total: number; succeeded: number | null };
    const title = `签到日报 ${date}`;
    const content = `总计 ${counts.total} 次，成功 ${counts.succeeded || 0} 次，失败 ${counts.total - (counts.succeeded || 0)} 次。`;
    if (!this.simulated) {
      const channels = (["serverchan", "wechat", "bark", "telegram", "webhook"] as NotificationChannel[])
        .filter((channel) => { const row = this.getChannel(channel, ownerUserId); return row.enabled && row.secret_cipher; });
      await Promise.allSettled(channels.map(async (channel) => {
        const row = this.getChannel(channel, ownerUserId);
        await this.send(channel, decryptSecret(row.secret_cipher!, this.database.key), content, title);
      }));
    }
    this.database.db.prepare(`INSERT INTO daily_summary_log(
      id, owner_user_id, summary_date, sent_at
    ) VALUES(?, ?, ?, ?)`).run(
      `${ownerUserId || "owner"}:${date}`,
      ownerUserId,
      date,
      new Date().toISOString(),
    );
  }

  private getChannel(channel: NotificationChannel, ownerUserId: string | null): ChannelRow {
    return this.database.db
      .prepare(
        `SELECT enabled, secret_cipher FROM notification_channels WHERE channel = ?
          AND ${ownerUserId ? "owner_user_id = ?" : "owner_user_id IS NULL"}`,
      )
      .get(...(ownerUserId ? [channel, ownerUserId] : [channel])) as ChannelRow;
  }

  private async send(
    channel: NotificationChannel,
    secret: string,
    content: string,
    title: string,
  ): Promise<void> {
    if (channel === "serverchan") {
      if (!/^[A-Za-z0-9_-]{8,256}$/.test(secret)) {
        throw new Error("Server酱 SendKey 格式无效");
      }
      const response = await fetch(`https://sctapi.ftqq.com/${secret}.send`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ title, desp: content }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Server酱通知失败：HTTP ${response.status}`);
      const body = (await response.json()) as {
        code?: number;
        data?: { errno?: number };
        message?: string;
      };
      if (body.code !== 0 && body.data?.errno !== 0) {
        throw new Error(`Server酱通知失败：${body.message || "未知错误"}`);
      }
      return;
    }

    if (channel === "bark") {
      const response = await fetch(`https://api.day.app/${encodeURIComponent(secret)}/${encodeURIComponent(title)}/${encodeURIComponent(content)}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Bark 通知失败：HTTP ${response.status}`);
      return;
    }
    if (channel === "telegram") {
      const [token, chatId] = secret.split("|", 2);
      if (!token || !chatId) throw new Error("Telegram 配置格式应为 botToken|chatId");
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: `${title}\n${content}` }), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Telegram 通知失败：HTTP ${response.status}`);
      return;
    }
    const webhook = new URL(secret);
    if (webhook.protocol !== "https:") throw new Error(`${channelName(channel)}地址必须使用 HTTPS`);
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: channel === "wechat"
        ? JSON.stringify({ msgtype: "markdown", markdown: { content } })
        : JSON.stringify({ title, content }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`${channelName(channel)}通知失败：HTTP ${response.status}`);
    if (channel === "webhook") return;
    const body = (await response.json()) as { errcode?: number; errmsg?: string };
    if (channel === "wechat" && body.errcode !== 0) {
      throw new Error(`企业微信通知失败：${body.errcode} ${body.errmsg || ""}`);
    }
  }
}

function channelName(channel: NotificationChannel): string {
  return ({ serverchan: "Server酱", wechat: "企业微信群机器人", bark: "Bark", telegram: "Telegram", webhook: "自定义 Webhook" })[channel];
}

function statusText(status: RunRecord["status"]): string {
  if (status === "success") return "签到成功";
  if (status === "already_checked") return "今日已签到";
  if (status === "session_expired") return "会话失效，需要人工更新";
  if (status === "cancelled") return "任务已取消";
  return "签到失败";
}
