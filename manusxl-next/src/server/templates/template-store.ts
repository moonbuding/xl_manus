import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createId } from "@/lib/id";
import {
  canUsePostgresRuntime,
  checkPsqlCli,
  requestedDatabaseProvider,
  runPsql
} from "@/server/db/provider";
import { getManusDb } from "@/server/sqlite";
import type { CreateTemplateRequest, TaskTemplate } from "@/types/agent";

const globalForTemplates = globalThis as unknown as {
  manusxlTemplateStore?: TemplatePersistenceAdapter;
};

const templateStoreVersion = 3;

interface TemplateRow {
  data_json: string;
  owner_id: string | null;
  is_public: number;
}

interface TemplatePersistenceAdapter {
  version: number;
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

function normalizeCategory(category?: string) {
  const normalized = category?.trim().toLowerCase();
  return normalized || "general";
}

function marketplaceDefaults(template: TaskTemplate): TaskTemplate {
  return {
    ...template,
    category: normalizeCategory(template.category),
    ratingAverage: Number(template.ratingAverage ?? 0),
    ratingCount: Number(template.ratingCount ?? 0),
    forkCount: Number(template.forkCount ?? 0),
    runCount: Number(template.runCount ?? 0),
    reviewStatus: template.reviewStatus ?? (template.isPublic ? "approved" : "draft")
  };
}

function publicTemplates() {
  const now = "2026-05-23T00:00:00.000Z";
  return [
    {
      id: "tpl_public_research",
      isPublic: true,
      category: "research",
      creatorName: "ManusXL",
      marketplaceFeatured: true,
      reviewStatus: "approved" as const,
      publishedAt: now,
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
      category: "analysis",
      creatorName: "ManusXL",
      marketplaceFeatured: true,
      reviewStatus: "approved" as const,
      publishedAt: now,
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
      category: "automation",
      creatorName: "ManusXL",
      marketplaceFeatured: true,
      reviewStatus: "approved" as const,
      publishedAt: now,
      name: "图片 OCR 批处理",
      description: "识别上传图片中的中英文文字，并生成 OCR 报告和 ZIP 包。",
      promptTemplate: "OCR 识别我上传的 {image_type} 图片里的中英文文字，并输出 OCR 报告和 ZIP 包。",
      defaultModel: undefined,
      tags: ["public", "image", "ocr"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "tpl_public_meeting_minutes",
      isPublic: true,
      category: "productivity",
      creatorName: "ManusXL",
      marketplaceFeatured: true,
      reviewStatus: "approved" as const,
      publishedAt: now,
      name: "会议纪要与行动项",
      description: "把会议记录整理为摘要、决策、负责人和待办表。",
      promptTemplate: "读取会议记录，整理 {project} 的会议摘要、关键决策、行动项、负责人和截止日期。",
      defaultModel: undefined,
      tags: ["public", "meeting", "productivity"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "tpl_public_prd",
      isPublic: true,
      category: "product",
      creatorName: "ManusXL",
      marketplaceFeatured: true,
      reviewStatus: "approved" as const,
      publishedAt: now,
      name: "PRD 与技术拆解",
      description: "把一句产品想法拆成 PRD、设计方案和研发任务。",
      promptTemplate: "围绕 {idea} 输出 PRD、核心用户故事、技术方案、里程碑和验收清单。",
      defaultModel: undefined,
      tags: ["public", "prd", "planning"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "tpl_public_sales_email",
      isPublic: true,
      category: "sales",
      creatorName: "ManusXL",
      marketplaceFeatured: false,
      reviewStatus: "approved" as const,
      publishedAt: now,
      name: "销售外联邮件",
      description: "基于客户画像生成多轮外联邮件和跟进话术。",
      promptTemplate: "面向 {customer_segment} 客户，基于 {product} 生成 3 封销售外联邮件和跟进话术。",
      defaultModel: undefined,
      tags: ["public", "sales", "email"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "tpl_public_data_report",
      isPublic: true,
      category: "analysis",
      creatorName: "ManusXL",
      marketplaceFeatured: false,
      reviewStatus: "approved" as const,
      publishedAt: now,
      name: "数据分析报告",
      description: "读取 CSV/XLSX 数据，输出洞察、图表建议和报告结构。",
      promptTemplate: "分析我上传的 {dataset} 数据，输出核心指标、异常点、业务洞察和可视化建议。",
      defaultModel: undefined,
      tags: ["public", "data", "analysis"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "tpl_public_trip_plan",
      isPublic: true,
      category: "lifestyle",
      creatorName: "ManusXL",
      marketplaceFeatured: false,
      reviewStatus: "approved" as const,
      publishedAt: now,
      name: "旅行路线规划",
      description: "生成多日路线、地点排序、预算和地图式网页。",
      promptTemplate: "规划 {city} {days} 日旅行路线，输出每日安排、预算、交通建议和地图式 HTML。",
      defaultModel: undefined,
      tags: ["public", "travel", "map"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "tpl_public_resume_review",
      isPublic: true,
      category: "career",
      creatorName: "ManusXL",
      marketplaceFeatured: false,
      reviewStatus: "approved" as const,
      publishedAt: now,
      name: "简历诊断优化",
      description: "解析简历并输出岗位匹配、修改建议和面试问题。",
      promptTemplate: "解析我上传的简历，面向 {role} 岗位输出亮点、风险、修改建议和面试准备清单。",
      defaultModel: undefined,
      tags: ["public", "resume", "career"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "tpl_public_weekly_report",
      isPublic: true,
      category: "productivity",
      creatorName: "ManusXL",
      marketplaceFeatured: false,
      reviewStatus: "approved" as const,
      publishedAt: now,
      name: "周报生成器",
      description: "把零散工作记录整理成管理层可读周报。",
      promptTemplate: "根据以下工作记录，为 {team} 生成本周进展、风险、下周计划和需要协同的问题。",
      defaultModel: undefined,
      tags: ["public", "weekly", "productivity"],
      createdAt: now,
      updatedAt: now
    }
  ].map(marketplaceDefaults) satisfies TaskTemplate[];
}

function seedPublicTemplatesSqlite(db: DatabaseSync) {
  for (const template of publicTemplates()) {
    db.prepare(
      `
      INSERT INTO task_templates
        (id, owner_id, name, description, prompt_template, default_model, tags_json, is_public, created_at, updated_at, data_json)
      VALUES (?, NULL, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
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
    version: templateStoreVersion,
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
            .prepare("DELETE FROM task_templates WHERE id = ? AND owner_id = ?")
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
    runPsql([
      "-c",
      `
        INSERT INTO task_templates
          (id, owner_id, name, description, prompt_template, default_model, tags_json, is_public, created_at, updated_at, data_json)
        VALUES (
          ${postgresValue(template.id)},
          NULL,
          ${postgresValue(template.name)},
          ${postgresValue(template.description)},
          ${postgresValue(template.promptTemplate)},
          ${postgresValue(template.defaultModel)},
          ${postgresValue(JSON.stringify(template.tags), { json: true })},
          1,
          ${postgresValue(template.createdAt)},
          ${postgresValue(template.updatedAt)},
          ${postgresValue(JSON.stringify(template), { json: true })}
        )
        ON CONFLICT (id) DO NOTHING;
      `
    ]);
  }
}

function createPostgresTemplateStore(): TemplatePersistenceAdapter {
  ensurePostgresSchema();
  seedPublicTemplatesPostgres();
  return {
    version: templateStoreVersion,
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
        ? `id = ${postgresValue(templateId)} AND owner_id = ${postgresValue(ownerId)}`
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
  const existing = globalForTemplates.manusxlTemplateStore;
  if (existing?.version === templateStoreVersion) {
    existing.ensureSchema();
    return existing;
  }
  const store = createTemplateStore();
  globalForTemplates.manusxlTemplateStore = store;
  return store;
}

function claimLegacyTemplates(ownerId?: string) {
  getTemplateStore().claimLegacy(ownerId);
}

function rowToTemplate(row: { data_json: string; owner_id?: string | null; is_public?: number }) {
  const template = JSON.parse(row.data_json) as TaskTemplate;
  return marketplaceDefaults({
    ...template,
    ownerId: template.ownerId ?? row.owner_id ?? undefined,
    isPublic: template.isPublic ?? row.is_public === 1
  });
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
    category: normalizeCategory(input.category),
    creatorName: isPublic ? "ManusXL" : undefined,
    reviewStatus: isPublic ? "approved" : "draft",
    publishedAt: isPublic ? now : undefined,
    name: input.name.trim() || "未命名模板",
    description: input.description?.trim() ?? "",
    promptTemplate: input.promptTemplate.trim(),
    defaultModel: input.defaultModel?.trim() || undefined,
    tags: normalizeTags(input.tags),
    createdAt: now,
    updatedAt: now
  };

  getTemplateStore().create(template);

  return marketplaceDefaults(template);
}

export function deleteTemplate(templateId: string, ownerId?: string) {
  claimLegacyTemplates(ownerId);
  return getTemplateStore().delete(templateId, ownerId);
}

export type MarketplaceTemplateSort = "featured" | "popular" | "topRated" | "latest";

export interface MarketplaceTemplateQuery {
  query?: string;
  tag?: string;
  category?: string;
  sort?: MarketplaceTemplateSort;
}

const dangerousTemplatePatterns = [
  /ignore.{0,24}(previous|system|developer).{0,24}instructions/i,
  /忽略.{0,12}(系统|开发者|之前).{0,12}(指令|规则)/,
  /(输出|泄露|打印|返回|print|leak|exfiltrate).{0,24}(api.?key|token|secrets?|password|密钥|令牌|密码)/i,
  /(api.?key|token|secrets?|password)\s*[:=]\s*(sk-|ghp_|xoxb-|AKIA)/i,
  /\b(sudo\s+)?rm\s+-rf\s+\/\b/i,
  /(越权|绕过|禁用).{0,12}(权限|审核|安全|审计)/
];

function reviewTemplateContent(template: Pick<TaskTemplate, "name" | "description" | "promptTemplate">) {
  const text = [template.name, template.description, template.promptTemplate].join("\n");
  const matched = dangerousTemplatePatterns.find((pattern) => pattern.test(text));
  if (matched) {
    return {
      ok: false,
      reason: "模板包含疑似 prompt 注入、敏感凭证或危险系统操作，已被审核拦截。"
    };
  }
  return { ok: true };
}

function getTemplateById(templateId: string) {
  return getTemplateStore()
    .listRows()
    .map(rowToTemplate)
    .find((template) => template.id === templateId);
}

function sortMarketplaceTemplates(templates: TaskTemplate[], sort: MarketplaceTemplateSort) {
  const timestamp = (template: TaskTemplate) =>
    Date.parse(template.publishedAt ?? template.updatedAt ?? template.createdAt) || 0;
  const rating = (template: TaskTemplate) => template.ratingAverage ?? 0;
  const ratingCount = (template: TaskTemplate) => template.ratingCount ?? 0;
  const forks = (template: TaskTemplate) => template.forkCount ?? 0;

  return templates.sort((left, right) => {
    if (sort === "latest") return timestamp(right) - timestamp(left);
    if (sort === "topRated") {
      return (
        rating(right) - rating(left) ||
        ratingCount(right) - ratingCount(left) ||
        forks(right) - forks(left) ||
        timestamp(right) - timestamp(left)
      );
    }
    if (sort === "popular") {
      return (
        forks(right) - forks(left) ||
        rating(right) - rating(left) ||
        ratingCount(right) - ratingCount(left) ||
        timestamp(right) - timestamp(left)
      );
    }
    return (
      Number(right.marketplaceFeatured ?? false) - Number(left.marketplaceFeatured ?? false) ||
      forks(right) - forks(left) ||
      rating(right) - rating(left) ||
      timestamp(right) - timestamp(left)
    );
  });
}

export function listMarketplaceTemplates(input: MarketplaceTemplateQuery = {}) {
  const normalizedQuery = input.query?.trim().toLowerCase();
  const normalizedTag = input.tag?.trim().toLowerCase();
  const normalizedCategory = input.category?.trim().toLowerCase();
  const sort = input.sort ?? "featured";

  const templates = getTemplateStore()
    .listRows()
    .map(rowToTemplate)
    .filter((template) => template.isPublic && template.reviewStatus !== "rejected")
    .filter((template) =>
      normalizedQuery
        ? template.name.toLowerCase().includes(normalizedQuery) ||
          template.description.toLowerCase().includes(normalizedQuery) ||
          template.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
        : true
    )
    .filter((template) =>
      normalizedTag ? template.tags.some((tag) => tag.toLowerCase() === normalizedTag) : true
    )
    .filter((template) =>
      normalizedCategory ? normalizeCategory(template.category) === normalizedCategory : true
    );

  return sortMarketplaceTemplates(templates, sort);
}

export function publishTemplate(templateId: string, ownerId: string, creatorName?: string) {
  claimLegacyTemplates(ownerId);
  const template = getTemplateStore()
    .listRows(ownerId)
    .map(rowToTemplate)
    .find((candidate) => candidate.id === templateId && candidate.ownerId === ownerId);
  if (!template) return { ok: false as const, status: 404, error: "Template not found" };

  const review = reviewTemplateContent(template);
  const now = new Date().toISOString();
  if (!review.ok) {
    const rejected = marketplaceDefaults({
      ...template,
      reviewStatus: "rejected",
      rejectionReason: review.reason,
      updatedAt: now
    });
    getTemplateStore().create(rejected);
    return { ok: false as const, status: 400, error: review.reason, template: rejected };
  }

  const published = marketplaceDefaults({
    ...template,
    isPublic: true,
    creatorName: creatorName || template.creatorName || "ManusXL 用户",
    reviewStatus: "approved",
    rejectionReason: undefined,
    publishedAt: template.publishedAt ?? now,
    updatedAt: now,
    tags: normalizeTags(["public", ...template.tags])
  });
  getTemplateStore().create(published);
  return { ok: true as const, template: published };
}

export function forkMarketplaceTemplate(templateId: string, ownerId: string) {
  const source = getTemplateById(templateId);
  if (!source?.isPublic || source.reviewStatus === "rejected") return undefined;

  const now = new Date().toISOString();
  const forked = marketplaceDefaults({
    ...source,
    id: createId("tpl"),
    ownerId,
    isPublic: false,
    sourceTemplateId: source.id,
    marketplaceFeatured: false,
    reviewStatus: "draft",
    publishedAt: undefined,
    name: `${source.name} 副本`,
    tags: normalizeTags(source.tags.filter((tag) => tag.toLowerCase() !== "public")),
    createdAt: now,
    updatedAt: now
  });
  const updatedSource = marketplaceDefaults({
    ...source,
    forkCount: (source.forkCount ?? 0) + 1,
    updatedAt: now
  });

  getTemplateStore().create(updatedSource);
  getTemplateStore().create(forked);
  return forked;
}

export function rateMarketplaceTemplate(templateId: string, rating: number) {
  const source = getTemplateById(templateId);
  if (!source?.isPublic || source.reviewStatus === "rejected") return undefined;
  const safeRating = Math.max(1, Math.min(5, Math.round(rating)));
  const currentCount = source.ratingCount ?? 0;
  const currentAverage = source.ratingAverage ?? 0;
  const nextCount = currentCount + 1;
  const nextAverage = Number(((currentAverage * currentCount + safeRating) / nextCount).toFixed(2));
  const updated = marketplaceDefaults({
    ...source,
    ratingAverage: nextAverage,
    ratingCount: nextCount,
    updatedAt: new Date().toISOString()
  });
  getTemplateStore().create(updated);
  return updated;
}
