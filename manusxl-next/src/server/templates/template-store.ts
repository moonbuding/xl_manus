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
      is_public INTEGER NOT NULL DEFAULT 0,
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
  if (!columns.has("is_public")) {
    db.exec("ALTER TABLE task_templates ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_templates_owner_id ON task_templates(owner_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_templates_is_public ON task_templates(is_public)");
  seedPublicTemplates(db);
}

function claimLegacyTemplates(ownerId?: string) {
  if (!ownerId) return;
  getDb()
    .prepare("UPDATE task_templates SET owner_id = ? WHERE owner_id IS NULL AND is_public = 0")
    .run(ownerId);
}

function normalizeTags(tags: string[] = []) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 8);
}

function publicTemplates() {
  const now = new Date().toISOString();
  return [
    {
      id: "tpl_public_research",
      isPublic: true,
      name: "竞品调研报告",
      description: "输入行业和目标公司，生成竞品分析、定位、价格建议和交付物。",
      promptTemplate:
        "调研 {industry} 行业的 {company} 及主要竞品，输出定位、价格、差异化建议，并生成报告、表格和 dashboard。",
      defaultModel: undefined,
      tags: ["public", "research", "dashboard"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "tpl_public_file_analysis",
      isPublic: true,
      name: "上传文档分析",
      description: "解析上传的 PDF/Word/Excel，输出摘要、风险点和行动建议。",
      promptTemplate: "读取我上传的 {file_type} 文件，提取重点内容，输出结构化分析报告和下一步建议。",
      defaultModel: undefined,
      tags: ["public", "file", "analysis"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "tpl_public_image_ocr",
      isPublic: true,
      name: "图片 OCR 批处理",
      description: "识别上传图片中的中英文文字，并生成 OCR 报告和 ZIP 包。",
      promptTemplate: "OCR 识别我上传的 {image_type} 图片里的中英文文字，并输出 OCR 报告和 ZIP 包。",
      defaultModel: undefined,
      tags: ["public", "image", "ocr"],
      createdAt: now,
      updatedAt: now
    }
  ] satisfies TaskTemplate[];
}

function seedPublicTemplates(db: DatabaseSync) {
  for (const template of publicTemplates()) {
    db.prepare(
      `
      INSERT INTO task_templates
        (id, owner_id, name, description, prompt_template, default_model, tags_json, is_public, created_at, updated_at, data_json)
      VALUES (?, NULL, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = NULL,
        name = excluded.name,
        description = excluded.description,
        prompt_template = excluded.prompt_template,
        default_model = excluded.default_model,
        tags_json = excluded.tags_json,
        is_public = 1,
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
    `
    ).run(
      template.id,
      template.name,
      template.description,
      template.promptTemplate,
      template.defaultModel ?? null,
      JSON.stringify(template.tags),
      template.createdAt,
      template.updatedAt,
      JSON.stringify(template)
    );
  }
}

function rowToTemplate(row: { data_json: string; owner_id?: string | null; is_public?: number }) {
  const template = JSON.parse(row.data_json) as TaskTemplate;
  return {
    ...template,
    ownerId: template.ownerId ?? row.owner_id ?? undefined,
    isPublic: template.isPublic ?? row.is_public === 1
  };
}

export function listTemplates(query?: string, ownerId?: string, tag?: string) {
  claimLegacyTemplates(ownerId);
  const rows = ownerId
    ? (getDb()
        .prepare(
          "SELECT data_json, owner_id, is_public FROM task_templates WHERE owner_id = ? OR is_public = 1 ORDER BY is_public ASC, datetime(updated_at) DESC"
        )
        .all(ownerId) as Array<{ data_json: string; owner_id: string | null; is_public: number }>)
    : (getDb()
        .prepare("SELECT data_json, owner_id, is_public FROM task_templates ORDER BY is_public ASC, datetime(updated_at) DESC")
        .all() as Array<{ data_json: string; owner_id: string | null; is_public: number }>);
  const normalized = query?.trim().toLowerCase();
  const normalizedTag = tag?.trim().toLowerCase();
  return rows
    .map(rowToTemplate)
    .filter((template) =>
      normalized
        ? template.name.toLowerCase().includes(normalized) ||
          template.description.toLowerCase().includes(normalized) ||
          template.tags.some((tag) => tag.toLowerCase().includes(normalized))
        : true
    )
    .filter((template) =>
      normalizedTag ? template.tags.some((tag) => tag.toLowerCase() === normalizedTag) : true
    );
}

export function createTemplate(input: CreateTemplateRequest, ownerId?: string) {
  const now = new Date().toISOString();
  const isPublic = input.isPublic === true && !ownerId;
  const template: TaskTemplate = {
    id: createId("tpl"),
    ownerId: isPublic ? undefined : ownerId,
    isPublic,
    name: input.name.trim() || "未命名模板",
    description: input.description?.trim() ?? "",
    promptTemplate: input.promptTemplate.trim(),
    defaultModel: input.defaultModel?.trim() || undefined,
    tags: normalizeTags(input.tags),
    createdAt: now,
    updatedAt: now
  };

  getDb()
    .prepare(
      `
      INSERT INTO task_templates
        (id, owner_id, name, description, prompt_template, default_model, tags_json, is_public, created_at, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      template.id,
      template.ownerId ?? null,
      template.name,
      template.description,
      template.promptTemplate,
      template.defaultModel ?? null,
      JSON.stringify(template.tags),
      template.isPublic ? 1 : 0,
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
        .prepare("DELETE FROM task_templates WHERE id = ? AND owner_id = ? AND is_public = 0")
        .run(templateId, ownerId)
    : getDb().prepare("DELETE FROM task_templates WHERE id = ? AND is_public = 0").run(templateId);
  return result.changes > 0;
}
