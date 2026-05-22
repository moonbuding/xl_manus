import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createId } from "@/lib/id";
import {
  canUsePostgresRuntime,
  checkPsqlCli,
  postgresDatabaseUrl,
  requestedDatabaseProvider
} from "@/server/db/provider";
import { getManusDb } from "@/server/sqlite";
import type { CreateTemplateRequest, TaskTemplate } from "@/types/agent";

const globalForTemplates = globalThis as unknown as {
  manusxlTemplateStore?: TemplatePersistenceAdapter;
};

interface TemplateRow {
  data_json: string;
  owner_id: string | null;
  is_public: number;
}

interface TemplatePersistenceAdapter {
  provider: "sqlite" | "postgres";
  ensureSchema: () => void;
  claimLegacy: (ownerId?: string) => void;
  listRows: (ownerId?: string) => TemplateRow[];
  create: (template: TaskTemplate) => void;
  delete: (templateId: string, ownerId?: string) => boolean;
}

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
  ensureSqliteTemplateSchema(db);
  return db;
}

function ensureSqliteTemplateSchema(db: DatabaseSync) {
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
  seedPublicTemplatesSqlite(db);
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

function seedPublicTemplatesSqlite(db: DatabaseSync) {
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

function insertTemplateSqlite(db: DatabaseSync, template: TaskTemplate) {
  db.prepare(
    `
      INSERT INTO task_templates
        (id, owner_id, name, description, prompt_template, default_model, tags_json, is_public, created_at, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        name = excluded.name,
        description = excluded.description,
        prompt_template = excluded.prompt_template,
        default_model = excluded.default_model,
        tags_json = excluded.tags_json,
        is_public = excluded.is_public,
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
    `
  ).run(
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
}

function createSqliteTemplateStore(): TemplatePersistenceAdapter {
  const db = openTemplateDb();
  return {
    provider: "sqlite",
    ensureSchema: () => ensureSqliteTemplateSchema(db),
    claimLegacy: (ownerId) => {
      if (!ownerId) return;
      db.prepare("UPDATE task_templates SET owner_id = ? WHERE owner_id IS NULL AND is_public = 0").run(ownerId);
    },
    listRows: (ownerId) =>
      ownerId
        ? (db
            .prepare(
              "SELECT data_json, owner_id, is_public FROM task_templates WHERE owner_id = ? OR is_public = 1 ORDER BY is_public ASC, datetime(updated_at) DESC"
            )
            .all(ownerId) as unknown as TemplateRow[])
        : (db
            .prepare(
              "SELECT data_json, owner_id, is_public FROM task_templates ORDER BY is_public ASC, datetime(updated_at) DESC"
            )
            .all() as unknown as TemplateRow[]),
    create: (template) => insertTemplateSqlite(db, template),
    delete: (templateId, ownerId) => {
      const result = ownerId
        ? db
            .prepare("DELETE FROM task_templates WHERE id = ? AND owner_id = ? AND is_public = 0")
            .run(templateId, ownerId)
        : db.prepare("DELETE FROM task_templates WHERE id = ? AND is_public = 0").run(templateId);
      return result.changes > 0;
    }
  };
}

function postgresSchemaPath() {
  return join(process.cwd(), "db", "postgres", "0001_initial.sql");
}

function quotePostgresString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function postgresValue(value: string | number | null | undefined, options: { json?: boolean } = {}) {
  if (value === undefined || value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return options.json ? `${quotePostgresString(value)}::jsonb` : quotePostgresString(value);
}

function runPsql(args: string[]) {
  const databaseUrl = postgresDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL 未配置，无法使用 PostgreSQL 模板存储");

  const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-X", "-q", ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "psql 执行失败").trim());
  }
  return result.stdout;
}

function ensurePostgresSchema() {
  const schemaPath = postgresSchemaPath();
  if (!existsSync(schemaPath)) {
    throw new Error(`找不到 PostgreSQL schema：${schemaPath}`);
  }
  runPsql(["-f", schemaPath]);
}

function parseTemplateRows(output: string) {
  return output.trim()
    ? output
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TemplateRow)
    : [];
}

function selectTemplateRowJson() {
  return `
    SELECT json_build_object(
      'data_json', data_json::text,
      'owner_id', owner_id,
      'is_public', is_public
    )::text
    FROM task_templates
  `;
}

function insertTemplatePostgres(template: TaskTemplate) {
  runPsql([
    "-c",
    `
      INSERT INTO task_templates
        (id, owner_id, name, description, prompt_template, default_model, tags_json, is_public, created_at, updated_at, data_json)
      VALUES (
        ${postgresValue(template.id)},
        ${postgresValue(template.ownerId)},
        ${postgresValue(template.name)},
        ${postgresValue(template.description)},
        ${postgresValue(template.promptTemplate)},
        ${postgresValue(template.defaultModel)},
        ${postgresValue(JSON.stringify(template.tags), { json: true })},
        ${postgresValue(template.isPublic ? 1 : 0)},
        ${postgresValue(template.createdAt)},
        ${postgresValue(template.updatedAt)},
        ${postgresValue(JSON.stringify(template), { json: true })}
      )
      ON CONFLICT (id) DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        prompt_template = EXCLUDED.prompt_template,
        default_model = EXCLUDED.default_model,
        tags_json = EXCLUDED.tags_json,
        is_public = EXCLUDED.is_public,
        updated_at = EXCLUDED.updated_at,
        data_json = EXCLUDED.data_json;
    `
  ]);
}

function seedPublicTemplatesPostgres() {
  for (const template of publicTemplates()) {
    insertTemplatePostgres(template);
  }
}

function createPostgresTemplateStore(): TemplatePersistenceAdapter {
  ensurePostgresSchema();
  seedPublicTemplatesPostgres();
  return {
    provider: "postgres",
    ensureSchema: ensurePostgresSchema,
    claimLegacy: (ownerId) => {
      if (!ownerId) return;
      runPsql([
        "-c",
        `
          UPDATE task_templates
          SET owner_id = ${postgresValue(ownerId)}
          WHERE owner_id IS NULL AND is_public = 0;
        `
      ]);
    },
    listRows: (ownerId) => {
      const where = ownerId
        ? `WHERE owner_id = ${postgresValue(ownerId)} OR is_public = 1`
        : "";
      return parseTemplateRows(
        runPsql([
          "-At",
          "-c",
          `
            ${selectTemplateRowJson()}
            ${where}
            ORDER BY is_public ASC, updated_at DESC;
          `
        ])
      );
    },
    create: insertTemplatePostgres,
    delete: (templateId, ownerId) => {
      const where = ownerId
        ? `id = ${postgresValue(templateId)} AND owner_id = ${postgresValue(ownerId)} AND is_public = 0`
        : `id = ${postgresValue(templateId)} AND is_public = 0`;
      const output = runPsql([
        "-At",
        "-c",
        `
          WITH deleted AS (
            DELETE FROM task_templates
            WHERE ${where}
            RETURNING id
          )
          SELECT COUNT(*) FROM deleted;
        `
      ]);
      return Number.parseInt(output.trim() || "0", 10) > 0;
    }
  };
}

function createTemplateStore(): TemplatePersistenceAdapter {
  const requestedProvider = requestedDatabaseProvider();
  if (requestedProvider === "postgres") {
    const psql = checkPsqlCli();
    if (!canUsePostgresRuntime(psql)) {
      console.warn(
        "MANUSXL_DATABASE_PROVIDER=postgres 已设置，但 DATABASE_URL 或 psql CLI 不可用，模板存储回退 SQLite。"
      );
      return createSqliteTemplateStore();
    }
    try {
      return createPostgresTemplateStore();
    } catch (error) {
      console.warn(
        `PostgreSQL 模板存储初始化失败，已回退 SQLite：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return createSqliteTemplateStore();
}

function getTemplateStore() {
  globalForTemplates.manusxlTemplateStore ??= createTemplateStore();
  globalForTemplates.manusxlTemplateStore.ensureSchema();
  return globalForTemplates.manusxlTemplateStore;
}

function claimLegacyTemplates(ownerId?: string) {
  getTemplateStore().claimLegacy(ownerId);
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
  const rows = getTemplateStore().listRows(ownerId);
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

  getTemplateStore().create(template);

  return template;
}

export function deleteTemplate(templateId: string, ownerId?: string) {
  claimLegacyTemplates(ownerId);
  return getTemplateStore().delete(templateId, ownerId);
}
