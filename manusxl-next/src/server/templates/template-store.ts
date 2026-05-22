import { DatabaseSync } from "node:sqlite";
import { createId } from "@/lib/id";
import { getManusDb } from "@/server/sqlite";
import type { CreateTemplateRequest, TaskTemplate } from "@/types/agent";

const globalForTemplates = globalThis as unknown as {
  manusxlTemplateDb?: DatabaseSync;
};

function openTemplateDb() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_templates (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt_template TEXT NOT NULL,
      default_model TEXT,
      tags_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
  `);
  ensureTemplateSchema(db);
  return db;
}

function getDb() {
  globalForTemplates.manusxlTemplateDb ??= openTemplateDb();
  ensureTemplateSchema(globalForTemplates.manusxlTemplateDb);
  return globalForTemplates.manusxlTemplateDb;
}

function ensureTemplateSchema(db: DatabaseSync) {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(task_templates)").all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );
  if (!columns.has("owner_id")) {
    db.exec("ALTER TABLE task_templates ADD COLUMN owner_id TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_templates_owner_id ON task_templates(owner_id)");
}

function claimLegacyTemplates(ownerId?: string) {
  if (!ownerId) return;
  getDb().prepare("UPDATE task_templates SET owner_id = ? WHERE owner_id IS NULL").run(ownerId);
}

function rowToTemplate(row: { data_json: string; owner_id?: string | null }) {
  const template = JSON.parse(row.data_json) as TaskTemplate;
  return {
    ...template,
    ownerId: template.ownerId ?? row.owner_id ?? undefined
  };
}

export function listTemplates(query?: string, ownerId?: string) {
  claimLegacyTemplates(ownerId);
  const rows = ownerId
    ? (getDb()
        .prepare("SELECT data_json, owner_id FROM task_templates WHERE owner_id = ? ORDER BY datetime(updated_at) DESC")
        .all(ownerId) as Array<{ data_json: string; owner_id: string | null }>)
    : (getDb()
        .prepare("SELECT data_json, owner_id FROM task_templates ORDER BY datetime(updated_at) DESC")
        .all() as Array<{ data_json: string; owner_id: string | null }>);
  const normalized = query?.trim().toLowerCase();
  return rows
    .map(rowToTemplate)
    .filter((template) =>
      normalized
        ? template.name.toLowerCase().includes(normalized) ||
          template.description.toLowerCase().includes(normalized) ||
          template.tags.some((tag) => tag.toLowerCase().includes(normalized))
        : true
    );
}

export function createTemplate(input: CreateTemplateRequest, ownerId?: string) {
  const now = new Date().toISOString();
  const template: TaskTemplate = {
    id: createId("tpl"),
    ownerId,
    name: input.name.trim() || "未命名模板",
    description: input.description?.trim() ?? "",
    promptTemplate: input.promptTemplate.trim(),
    defaultModel: input.defaultModel?.trim() || undefined,
    tags: input.tags?.map((tag) => tag.trim()).filter(Boolean).slice(0, 8) ?? [],
    createdAt: now,
    updatedAt: now
  };

  getDb()
    .prepare(
      `
      INSERT INTO task_templates
        (id, owner_id, name, description, prompt_template, default_model, tags_json, created_at, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      template.id,
      ownerId ?? null,
      template.name,
      template.description,
      template.promptTemplate,
      template.defaultModel ?? null,
      JSON.stringify(template.tags),
      template.createdAt,
      template.updatedAt,
      JSON.stringify(template)
    );

  return template;
}

export function deleteTemplate(templateId: string, ownerId?: string) {
  claimLegacyTemplates(ownerId);
  const result = ownerId
    ? getDb()
        .prepare("DELETE FROM task_templates WHERE id = ? AND owner_id = ?")
        .run(templateId, ownerId)
    : getDb().prepare("DELETE FROM task_templates WHERE id = ?").run(templateId);
  return result.changes > 0;
}
