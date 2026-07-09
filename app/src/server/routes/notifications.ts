import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  NotificationChannel,
  NotificationChannelConfig,
  NotificationTemplate,
  TemplateStatus,
} from "../../shared/types.js";
import type { AppDatabase } from "../database.js";
import { encryptSecret } from "../crypto.js";
import {
  renderTemplate,
  sampleTemplateData,
  validateTemplate,
} from "../services/template.js";
import type { NotificationService } from "../services/notifier.js";
import { consumeDailyAction, principalOwnerId, writeAudit } from "../services/access.js";

const channelSchema = z.enum(["serverchan", "wechat", "bark", "telegram", "webhook"]);
const statusSchema = z.enum(["success", "already_checked", "failure"]);

function channelConfig(
  database: AppDatabase,
  channel: NotificationChannel,
  ownerUserId: string | null,
): NotificationChannelConfig {
  const row = database.db
    .prepare(`SELECT * FROM notification_channels WHERE channel = ?
      AND ${ownerUserId ? "owner_user_id = ?" : "owner_user_id IS NULL"}`)
    .get(...(ownerUserId ? [channel, ownerUserId] : [channel])) as { enabled: number; secret_cipher: string | null };
  return {
    channel,
    enabled: Boolean(row.enabled),
    configured: Boolean(row.secret_cipher),
    secretMasked: row.secret_cipher ? "••••••••••••" : "",
  };
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  notifier: NotificationService,
): void {
  app.get("/api/notifications", async (request) => {
    const ownerUserId = principalOwnerId(app.getAuthPrincipal(request)!);
    database.ensureNotificationDefaults(ownerUserId);
    const channels = (["serverchan", "wechat", "bark", "telegram", "webhook"] as NotificationChannel[]).map(
      (channel) => channelConfig(database, channel, ownerUserId),
    );
    const templates = database.db
      .prepare(`SELECT channel, status, content FROM notification_templates
        WHERE ${ownerUserId ? "owner_user_id = ?" : "owner_user_id IS NULL"}`)
      .all(...(ownerUserId ? [ownerUserId] : [])) as NotificationTemplate[];
    return { channels, templates };
  });

  app.put("/api/notifications/channels/:channel", async (request) => {
    const principal = app.getAuthPrincipal(request)!;
    const ownerUserId = principalOwnerId(principal);
    const { channel } = z
      .object({ channel: channelSchema })
      .parse(request.params) as { channel: NotificationChannel };
    const body = z
      .object({ enabled: z.boolean(), secret: z.string().max(1_000).optional() })
      .parse(request.body);
    const current = database.db
      .prepare(`SELECT secret_cipher FROM notification_channels WHERE channel = ?
        AND ${ownerUserId ? "owner_user_id = ?" : "owner_user_id IS NULL"}`)
      .get(...(ownerUserId ? [channel, ownerUserId] : [channel])) as { secret_cipher: string | null };
    const cipher = body.secret?.trim()
      ? encryptSecret(body.secret.trim(), database.key)
      : current.secret_cipher;
    database.db
      .prepare(`UPDATE notification_channels
        SET enabled = ?, secret_cipher = ?, updated_at = ? WHERE channel = ?
        AND ${ownerUserId ? "owner_user_id = ?" : "owner_user_id IS NULL"}`)
      .run(Number(body.enabled), cipher, new Date().toISOString(), channel, ...(ownerUserId ? [ownerUserId] : []));
    writeAudit(database, principal, "notification.channel.update", "notification", { targetLabel: channel });
    return channelConfig(database, channel, ownerUserId);
  });

  app.put(
    "/api/notifications/templates/:channel/:status",
    async (request) => {
      const principal = app.getAuthPrincipal(request)!;
      const ownerUserId = principalOwnerId(principal);
      const parameters = z
        .object({ channel: channelSchema, status: statusSchema })
        .parse(request.params) as {
        channel: NotificationChannel;
        status: TemplateStatus;
      };
      const { content } = z
        .object({ content: z.string().max(2_000) })
        .parse(request.body);
      validateTemplate(content);
      database.db
        .prepare(`UPDATE notification_templates
          SET content = ?, updated_at = ? WHERE channel = ? AND status = ?
          AND ${ownerUserId ? "owner_user_id = ?" : "owner_user_id IS NULL"}`)
        .run(
          content,
          new Date().toISOString(),
          parameters.channel,
          parameters.status,
          ...(ownerUserId ? [ownerUserId] : []),
        );
      writeAudit(database, principal, "notification.template.update", "notification_template", {
        targetLabel: `${parameters.channel}:${parameters.status}`,
      });
      return { ...parameters, content };
    },
  );

  app.post("/api/notifications/preview", async (request) => {
    const { content } = z
      .object({ content: z.string().max(2_000) })
      .parse(request.body);
    return { rendered: renderTemplate(content, sampleTemplateData) };
  });

  app.post("/api/notifications/test/:channel", async (request) => {
    const principal = app.getAuthPrincipal(request)!;
    const ownerUserId = principalOwnerId(principal);
    const { channel } = z
      .object({ channel: channelSchema })
      .parse(request.params) as { channel: NotificationChannel };
    consumeDailyAction(database, principal);
    writeAudit(database, principal, "notification.test", "notification", { targetLabel: channel });
    return {
      success: true,
      message: await notifier.sendTest(channel, ownerUserId),
    };
  });
}
