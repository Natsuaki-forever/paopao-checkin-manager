import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { normalizeBrowserFormTemplateConfig } from "../../shared/browser-form.js";
import type { BrowserFormTemplateConfig, ExecutionTemplate, HttpFlowTemplateV1, TaskTemplateId } from "../../shared/types.js";
import { httpFlowTemplateSchema } from "../http-flow/schema.js";

interface TemplateRow {
  id: string; adapter_id: TaskTemplateId; name: string; version: number;
  config: string; is_preset: number; is_private: number;
  created_at: string; updated_at: string;
  tested_at: string | null;
  description: string;
  owner_user_id: string | null;
  is_shared: number;
}
const fromRow = (row: TemplateRow): ExecutionTemplate => ({
  id: row.id,
  ownerUserId: row.owner_user_id || undefined,
  adapterId: row.adapter_id,
  name: row.name,
  description: row.description || undefined,
  version: row.version,
  config: row.adapter_id === "http_flow"
    ? httpFlowTemplateSchema.parse(JSON.parse(row.config))
    : normalizeBrowserFormTemplateConfig(JSON.parse(row.config)),
  isPreset: Boolean(row.is_preset),
  isPrivate: Boolean(row.is_private),
  isShared: Boolean(row.is_shared),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  testedAt: row.tested_at || undefined,
});

export class ExecutionTemplateRepository {
  constructor(readonly db: Database.Database) {}
  list(): ExecutionTemplate[] {
    return (this.db.prepare("SELECT * FROM templates ORDER BY is_preset DESC, updated_at DESC")
      .all() as TemplateRow[]).map(fromRow);
  }
  listVisible(ownerUserId: string | null): ExecutionTemplate[] {
    const rows = ownerUserId
      ? this.db.prepare(`SELECT * FROM templates
          WHERE is_preset = 1 OR is_shared = 1 OR owner_user_id = ?
          ORDER BY is_preset DESC, is_shared DESC, updated_at DESC`).all(ownerUserId)
      : this.db.prepare(`SELECT * FROM templates
          WHERE is_preset = 1 OR is_shared = 1 OR owner_user_id IS NULL
          ORDER BY is_preset DESC, is_shared DESC, updated_at DESC`).all();
    return (rows as TemplateRow[]).map(fromRow);
  }
  get(id: string): ExecutionTemplate | undefined {
    const row = this.db.prepare("SELECT * FROM templates WHERE id = ?").get(id) as TemplateRow | undefined;
    return row ? fromRow(row) : undefined;
  }
  getVisible(id: string, ownerUserId: string | null): ExecutionTemplate | undefined {
    return this.listVisible(ownerUserId).find((item) => item.id === id);
  }
  getOwned(id: string, ownerUserId: string | null): ExecutionTemplate | undefined {
    const template = this.get(id);
    return template && (template.ownerUserId || null) === ownerUserId && !template.isPreset && !template.isShared
      ? template
      : undefined;
  }
  create(
    name: string,
    config: BrowserFormTemplateConfig | HttpFlowTemplateV1,
    isPrivate = false,
    adapterId: TaskTemplateId = "browser_form",
    ownerUserId: string | null = null,
  ): ExecutionTemplate {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this.db.prepare(`INSERT INTO templates(
      id, owner_user_id, adapter_id, name, version, config, is_private, created_at, updated_at
    ) VALUES(?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .run(id, ownerUserId, adapterId, name, JSON.stringify(config), Number(isPrivate), timestamp, timestamp);
    return this.get(id)!;
  }
  updateOwned(id: string, ownerUserId: string | null, name: string, config: BrowserFormTemplateConfig | HttpFlowTemplateV1): ExecutionTemplate | undefined {
    if (!this.getOwned(id, ownerUserId)) return undefined;
    return this.update(id, name, config);
  }
  update(id: string, name: string, config: BrowserFormTemplateConfig | HttpFlowTemplateV1): ExecutionTemplate | undefined {
    const result = this.db.prepare(`UPDATE templates SET name = ?, version = version + 1,
      config = ?, tested_at = NULL, updated_at = ? WHERE id = ? AND is_preset = 0`)
      .run(name, JSON.stringify(config), new Date().toISOString(), id);
    return result.changes ? this.get(id) : undefined;
  }
  copy(id: string, name?: string): ExecutionTemplate | undefined {
    const source = this.get(id);
    return source ? this.create(name || `${source.name} 副本`, source.config, false, source.adapterId) : undefined;
  }
  copyForOwner(id: string, ownerUserId: string | null, name?: string): ExecutionTemplate | undefined {
    const source = this.getVisible(id, ownerUserId);
    return source
      ? this.create(name || `${source.name} 副本`, source.config, false, source.adapterId, ownerUserId)
      : undefined;
  }
  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM templates WHERE id = ? AND is_preset = 0").run(id).changes > 0;
  }
  deleteOwned(id: string, ownerUserId: string | null): boolean {
    if (!this.getOwned(id, ownerUserId)) return false;
    return this.delete(id);
  }
  markTested(id: string): void {
    this.db.prepare("UPDATE templates SET tested_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }
}
