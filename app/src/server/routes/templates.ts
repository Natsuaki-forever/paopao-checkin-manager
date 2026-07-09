import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeBrowserFormTemplateConfig } from "../../shared/browser-form.js";
import type { ExecutionTemplateRepository } from "../repositories/execution-template.js";
import { httpFlowTemplateSchema } from "../http-flow/schema.js";
import { executeHttpFlow } from "../http-flow/executor.js";
import { randomUUID } from "node:crypto";
import { normalizeBrowserFormTemplateConfig as normalizeSubmissionConfig } from "../../shared/browser-form.js";
import {
  consumeDailyAction,
  notFound,
  principalOwnerId,
  requireCapability,
  writeAudit,
} from "../services/access.js";

const idSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({ name: z.string().trim().min(1).max(100), adapterId: z.enum(["browser_form", "http_flow"]).default("browser_form"), source: z.enum(["manual", "har"]).optional(), config: z.record(z.string(), z.unknown()) });
const parseConfig = (adapterId: "browser_form" | "http_flow", config: Record<string, unknown>) =>
  adapterId === "http_flow" ? httpFlowTemplateSchema.parse(config) : normalizeBrowserFormTemplateConfig(config);

export function registerTemplateRoutes(app: FastifyInstance, templates: ExecutionTemplateRepository): void {
  app.get("/api/templates", async (request) => ({
    items: templates.listVisible(principalOwnerId(app.getAuthPrincipal(request)!)),
  }));
  app.post("/api/templates", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    const body = bodySchema.parse(request.body);
    if (body.adapterId === "http_flow") {
      requireCapability(principal, body.source === "har" ? "importHar" : "useHttpFlow");
    }
    const created = templates.create(
      body.name,
      parseConfig(body.adapterId, body.config),
      false,
      body.adapterId,
      principalOwnerId(principal),
    );
    writeAudit(templates, principal, "template.create", "template", {
      targetId: created.id,
      targetLabel: created.name,
    });
    return reply.code(201).send(created);
  });
  app.put("/api/templates/:id", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    const { id } = idSchema.parse(request.params);
    const body = bodySchema.parse(request.body);
    const ownerUserId = principalOwnerId(principal);
    const existing = templates.getOwned(id, ownerUserId);
    if (existing?.adapterId === "http_flow") requireCapability(principal, "useHttpFlow");
    const updated = existing && templates.updateOwned(id, ownerUserId, body.name, parseConfig(existing.adapterId, body.config));
    if (updated) writeAudit(templates, principal, "template.update", "template", { targetId: id, targetLabel: updated.name });
    return updated || reply.code(404).send({ message: "模板不存在或为只读预置模板" });
  });
  app.post("/api/templates/:id/copy", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    const { id } = idSchema.parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(100).optional() }).parse(request.body || {});
    const source = templates.getVisible(id, principalOwnerId(principal));
    if (source?.adapterId === "http_flow") requireCapability(principal, "useHttpFlow");
    const copied = templates.copyForOwner(id, principalOwnerId(principal), body.name);
    if (copied) writeAudit(templates, principal, "template.copy", "template", { targetId: copied.id, targetLabel: copied.name });
    return copied ? reply.code(201).send(copied) : reply.code(404).send({ message: "模板不存在" });
  });
  app.get("/api/templates/:id/export", async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const template = templates.getVisible(id, principalOwnerId(app.getAuthPrincipal(request)!));
    if (!template) return reply.code(404).send({ message: "模板不存在" });
    return { schema: "browser-form-template/v1", name: template.name, adapterId: template.adapterId, version: template.version, config: template.config };
  });
  app.delete("/api/templates/:id", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    const { id } = idSchema.parse(request.params);
    const template = templates.getOwned(id, principalOwnerId(principal));
    if (!template || !templates.deleteOwned(id, principalOwnerId(principal))) {
      return reply.code(409).send({ message: "模板不存在或不可删除" });
    }
    writeAudit(templates, principal, "template.delete", "template", { targetId: id, targetLabel: template.name });
    return reply.code(204).send();
  });
  app.post("/api/templates/:id/http-test", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    requireCapability(principal, "useHttpFlow");
    const { id } = idSchema.parse(request.params);
    const template = templates.getOwned(id, principalOwnerId(principal));
    if (!template || template.adapterId !== "http_flow") return reply.code(404).send({ message: "HTTP 流程模板不存在" });
    const input = z.object({
      variables: z.record(z.string(), z.string()).optional(),
      secrets: z.record(z.string(), z.string()).optional(),
      cookies: z.record(z.string(), z.string()).optional(),
      proxy: z.string().url().optional(),
      stepId: z.string().optional(),
    }).parse(request.body || {});
    consumeDailyAction(templates, principal);
    const result = await executeHttpFlow(httpFlowTemplateSchema.parse(template.config), input, undefined, input.stepId);
    if (!input.stepId) templates.markTested(id);
    return result;
  });

  app.post("/api/templates/:id/submit", async (request, reply) => {
    const principal = app.getAuthPrincipal(request)!;
    requireCapability(principal, "submitSharedTemplates");
    const { id } = idSchema.parse(request.params);
    const template = templates.getOwned(id, principalOwnerId(principal));
    if (!template || template.adapterId !== "browser_form") {
      return reply.code(404).send({ message: "只有自己的浏览器模板可以提交审核" });
    }
    const body = z.object({
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().trim().max(500).default(""),
    }).parse(request.body || {});
    const pending = templates.db.prepare(`SELECT 1 FROM template_submissions
      WHERE source_template_id = ? AND status = 'pending'`).get(id);
    if (pending) return reply.code(409).send({ message: "该模板已有待审核版本" });
    const submissionId = randomUUID();
    templates.db.prepare(`INSERT INTO template_submissions(
      id, source_template_id, submitter_user_id, submitter_name,
      name, description, config_snapshot, status, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
      submissionId,
      id,
      principal.userId || null,
      principal.displayName,
      body.name || template.name,
      body.description || template.description || "",
      JSON.stringify(normalizeSubmissionConfig(template.config as unknown as Record<string, unknown>)),
      new Date().toISOString(),
    );
    writeAudit(templates, principal, "template.submit", "template_submission", {
      targetId: submissionId,
      targetLabel: body.name || template.name,
    });
    return reply.code(201).send({ id: submissionId, status: "pending" });
  });

  app.get("/api/template-submissions", async (request) => {
    const principal = app.getAuthPrincipal(request)!;
    const rows = principal.userId
      ? templates.db.prepare(`SELECT id, source_template_id, name, description, status,
          review_note, published_template_id, created_at, reviewed_at
          FROM template_submissions WHERE submitter_user_id = ? ORDER BY created_at DESC`).all(principal.userId)
      : templates.db.prepare(`SELECT id, source_template_id, name, description, status,
          review_note, published_template_id, created_at, reviewed_at
          FROM template_submissions WHERE submitter_user_id IS NULL ORDER BY created_at DESC`).all();
    return { items: (rows as any[]).map((row) => ({
      id: row.id,
      sourceTemplateId: row.source_template_id || undefined,
      name: row.name,
      description: row.description,
      status: row.status,
      reviewNote: row.review_note || undefined,
      publishedTemplateId: row.published_template_id || undefined,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at || undefined,
    })) };
  });

  app.post("/api/template-submissions/:id/withdraw", async (request) => {
    const principal = app.getAuthPrincipal(request)!;
    const { id } = idSchema.parse(request.params);
    const ownerClause = principal.userId ? "submitter_user_id = ?" : "submitter_user_id IS NULL";
    const parameters = principal.userId ? [new Date().toISOString(), id, principal.userId] : [new Date().toISOString(), id];
    const changed = templates.db.prepare(`UPDATE template_submissions SET status = 'withdrawn', reviewed_at = ?
      WHERE id = ? AND status = 'pending' AND ${ownerClause}`).run(...parameters).changes;
    if (!changed) throw notFound("待审核模板不存在");
    writeAudit(templates, principal, "template_submission.withdraw", "template_submission", { targetId: id });
    return { success: true };
  });
}
