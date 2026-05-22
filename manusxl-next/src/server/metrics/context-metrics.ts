import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createId } from "@/lib/id";
import { estimateCost } from "@/server/billing/pricing";
import type { ChatMessage } from "@/server/llm/deepseek";
import { dataPath } from "@/server/data-root";
import {
  canUsePostgresRuntime,
  checkPsqlCli,
  postgresDatabaseUrl,
  requestedDatabaseProvider
} from "@/server/db/provider";
import { getManusDb } from "@/server/sqlite";
import { listTasks } from "@/server/tasks/task-store";
import type { ContextMetric, ContextMetricsSummary } from "@/types/agent";

interface UsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

interface RecordMetricInput {
  taskId?: string;
  stage?: string;
  provider: string;
  model: string;
  messages: ChatMessage[];
  usage?: UsagePayload;
  promptCacheEnabled?: boolean;
  fallbackUsed: boolean;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

const dbFile = dataPath("manusxl.sqlite");
const stablePrefixMarker = "\n\n当前角色：";

const globalForMetrics = globalThis as unknown as {
  manusxlMetricsStore?: MetricPersistenceAdapter;
};

interface MetricPersistenceAdapter {
  provider: "sqlite" | "postgres";
  ensureSchema: () => void;
  hasSeenPrefix: (prefixHash: string, taskId?: string) => boolean;
  insertMetric: (metric: ContextMetric) => void;
  readMetrics: (taskId?: string, limit?: number) => ContextMetric[];
  readAllMetricsForSummary: (taskId?: string) => ContextMetric[];
  readMetricsInRange: (startIso: string, endIso: string, limit?: number) => ContextMetric[];
  latestMetric: (taskId?: string, stage?: string) => ContextMetric | undefined;
}

const metricColumnMigrations: Record<string, string> = {
  estimated_cost_usd: "REAL NOT NULL DEFAULT 0",
  estimated_cost_cny: "REAL NOT NULL DEFAULT 0"
};

function ensureMetricColumns(db: DatabaseSync) {
  const existingColumns = new Set(
    (db.prepare("PRAGMA table_info(context_metrics)").all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );

  Object.entries(metricColumnMigrations).forEach(([column, definition]) => {
    if (!existingColumns.has(column)) {
      db.exec(`ALTER TABLE context_metrics ADD COLUMN ${column} ${definition}`);
    }
  });
}

function openMetricsDatabase() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS context_metrics (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      stage TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prefix_hash TEXT NOT NULL,
      prefix_tokens INTEGER NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      cache_creation_tokens INTEGER NOT NULL,
      cache_hit_rate REAL NOT NULL,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      estimated_cost_cny REAL NOT NULL DEFAULT 0,
      stable_prefix_reused INTEGER NOT NULL,
      fallback_used INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_context_metrics_task_id ON context_metrics(task_id);
    CREATE INDEX IF NOT EXISTS idx_context_metrics_prefix_hash ON context_metrics(prefix_hash);
    CREATE INDEX IF NOT EXISTS idx_context_metrics_created_at ON context_metrics(created_at);
  `);
  ensureMetricColumns(db);
  return db;
}

function createSqliteMetricStore(): MetricPersistenceAdapter {
  const db = openMetricsDatabase();
  const rowsToMetrics = (rows: Array<{ data_json: string }>) =>
    rows.map((row) => normalizeMetric(JSON.parse(row.data_json) as ContextMetric));

  return {
    provider: "sqlite",
    ensureSchema: () => ensureMetricColumns(db),
    hasSeenPrefix: (prefixHash, taskId) => {
      if (!taskId) return false;
      const row = db
        .prepare("SELECT COUNT(*) AS count FROM context_metrics WHERE prefix_hash = ? AND task_id = ?")
        .get(prefixHash, taskId) as { count: number };
      return row.count > 0;
    },
    insertMetric: (metric) => {
      db.prepare(
        `
        INSERT INTO context_metrics (
          id, task_id, stage, provider, model, prefix_hash, prefix_tokens,
          prompt_tokens, completion_tokens, total_tokens, cache_read_tokens,
          cache_creation_tokens, cache_hit_rate, estimated_cost_usd,
          estimated_cost_cny, stable_prefix_reused,
          fallback_used, latency_ms, created_at, data_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
        .run(
          metric.id,
          metric.taskId ?? null,
          metric.stage,
          metric.provider,
          metric.model,
          metric.prefixHash,
          metric.prefixTokens,
          metric.promptTokens,
          metric.completionTokens,
          metric.totalTokens,
          metric.cacheReadTokens,
          metric.cacheCreationTokens,
          metric.cacheHitRate,
          metric.estimatedCostUsd,
          metric.estimatedCostCny,
          metric.stablePrefixReused ? 1 : 0,
          metric.fallbackUsed ? 1 : 0,
          metric.latencyMs,
          metric.createdAt,
          JSON.stringify(metric)
        );
    },
    readMetrics: (taskId, limit = 50) => {
      const rows = taskId
        ? (db
            .prepare(
              "SELECT data_json FROM context_metrics WHERE task_id = ? ORDER BY datetime(created_at) DESC LIMIT ?"
            )
            .all(taskId, limit) as Array<{ data_json: string }>)
        : (db
            .prepare("SELECT data_json FROM context_metrics ORDER BY datetime(created_at) DESC LIMIT ?")
            .all(limit) as Array<{ data_json: string }>);

      return rowsToMetrics(rows);
    },
    readAllMetricsForSummary: (taskId) => {
      const rows = taskId
        ? (db
            .prepare("SELECT data_json FROM context_metrics WHERE task_id = ? ORDER BY datetime(created_at) DESC")
            .all(taskId) as Array<{ data_json: string }>)
        : (db
            .prepare("SELECT data_json FROM context_metrics ORDER BY datetime(created_at) DESC LIMIT 1000")
            .all() as Array<{ data_json: string }>);

      return rowsToMetrics(rows);
    },
    readMetricsInRange: (startIso, endIso, limit = 5000) => {
      const rows = db
        .prepare(
          `
          SELECT data_json FROM context_metrics
          WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)
          ORDER BY datetime(created_at) DESC
          LIMIT ?
        `
        )
        .all(startIso, endIso, limit) as Array<{ data_json: string }>;

      return rowsToMetrics(rows);
    },
    latestMetric: (taskId, stage) => {
      const rows = stage
        ? (db
            .prepare(
              `
              SELECT data_json FROM context_metrics
              WHERE (? IS NULL OR task_id = ?) AND stage = ?
              ORDER BY datetime(created_at) DESC
              LIMIT 1
            `
            )
            .all(taskId ?? null, taskId ?? null, stage) as Array<{ data_json: string }>)
        : (db
            .prepare(
              `
              SELECT data_json FROM context_metrics
              WHERE (? IS NULL OR task_id = ?)
              ORDER BY datetime(created_at) DESC
              LIMIT 1
            `
            )
            .all(taskId ?? null, taskId ?? null) as Array<{ data_json: string }>);

      return rows[0] ? normalizeMetric(JSON.parse(rows[0].data_json) as ContextMetric) : undefined;
    }
  };
}

function postgresSchemaPath() {
  return `${process.cwd()}/db/postgres/0001_initial.sql`;
}

function quotePostgresString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function postgresValue(value: unknown, options: { json?: boolean } = {}) {
  if (value === undefined || value === null) return "NULL";
  if (options.json) return `${quotePostgresString(JSON.stringify(value))}::jsonb`;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return quotePostgresString(String(value));
}

function runPsql(args: string[]) {
  const databaseUrl = postgresDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL 未配置，无法使用 PostgreSQL Context 指标存储");

  const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-X", "-q", ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
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

function metricInsertSql(metric: ContextMetric) {
  return `
    INSERT INTO context_metrics (
      id, task_id, stage, provider, model, prefix_hash, prefix_tokens,
      prompt_tokens, completion_tokens, total_tokens, cache_read_tokens,
      cache_creation_tokens, cache_hit_rate, estimated_cost_usd,
      estimated_cost_cny, stable_prefix_reused,
      fallback_used, latency_ms, created_at, data_json
    )
    VALUES (
      ${postgresValue(metric.id)},
      ${postgresValue(metric.taskId)},
      ${postgresValue(metric.stage)},
      ${postgresValue(metric.provider)},
      ${postgresValue(metric.model)},
      ${postgresValue(metric.prefixHash)},
      ${postgresValue(metric.prefixTokens)},
      ${postgresValue(metric.promptTokens)},
      ${postgresValue(metric.completionTokens)},
      ${postgresValue(metric.totalTokens)},
      ${postgresValue(metric.cacheReadTokens)},
      ${postgresValue(metric.cacheCreationTokens)},
      ${postgresValue(metric.cacheHitRate)},
      ${postgresValue(metric.estimatedCostUsd)},
      ${postgresValue(metric.estimatedCostCny)},
      ${postgresValue(metric.stablePrefixReused ? 1 : 0)},
      ${postgresValue(metric.fallbackUsed ? 1 : 0)},
      ${postgresValue(metric.latencyMs)},
      ${postgresValue(metric.createdAt)},
      ${postgresValue(metric, { json: true })}
    );
  `;
}

function parsePostgresMetricRows(output: string) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeMetric(JSON.parse(line) as ContextMetric));
}

function createPostgresMetricStore(): MetricPersistenceAdapter {
  ensurePostgresSchema();
  return {
    provider: "postgres",
    ensureSchema: ensurePostgresSchema,
    hasSeenPrefix: (prefixHash, taskId) => {
      if (!taskId) return false;
      const output = runPsql([
        "-At",
        "-c",
        `
          SELECT COUNT(*)
          FROM context_metrics
          WHERE prefix_hash = ${postgresValue(prefixHash)}
            AND task_id = ${postgresValue(taskId)};
        `
      ]);
      return Number(output.trim()) > 0;
    },
    insertMetric: (metric) => {
      runPsql(["-c", metricInsertSql(metric)]);
    },
    readMetrics: (taskId, limit = 50) => {
      const where = taskId ? `WHERE task_id = ${postgresValue(taskId)}` : "";
      return parsePostgresMetricRows(
        runPsql([
          "-At",
          "-c",
          `
            SELECT data_json::text
            FROM context_metrics
            ${where}
            ORDER BY created_at DESC
            LIMIT ${Math.max(1, Math.floor(limit))};
          `
        ])
      );
    },
    readAllMetricsForSummary: (taskId) => {
      const where = taskId ? `WHERE task_id = ${postgresValue(taskId)}` : "";
      const limit = taskId ? "" : "LIMIT 1000";
      return parsePostgresMetricRows(
        runPsql([
          "-At",
          "-c",
          `
            SELECT data_json::text
            FROM context_metrics
            ${where}
            ORDER BY created_at DESC
            ${limit};
          `
        ])
      );
    },
    readMetricsInRange: (startIso, endIso, limit = 5000) =>
      parsePostgresMetricRows(
        runPsql([
          "-At",
          "-c",
          `
            SELECT data_json::text
            FROM context_metrics
            WHERE created_at >= ${postgresValue(startIso)}
              AND created_at < ${postgresValue(endIso)}
            ORDER BY created_at DESC
            LIMIT ${Math.max(1, Math.floor(limit))};
          `
        ])
      ),
    latestMetric: (taskId, stage) => {
      const filters = [
        taskId ? `task_id = ${postgresValue(taskId)}` : undefined,
        stage ? `stage = ${postgresValue(stage)}` : undefined
      ].filter(Boolean);
      const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      const metrics = parsePostgresMetricRows(
        runPsql([
          "-At",
          "-c",
          `
            SELECT data_json::text
            FROM context_metrics
            ${where}
            ORDER BY created_at DESC
            LIMIT 1;
          `
        ])
      );
      return metrics[0];
    }
  };
}

function createMetricStore(): MetricPersistenceAdapter {
  const requestedProvider = requestedDatabaseProvider();
  if (requestedProvider === "postgres") {
    const psql = checkPsqlCli();
    if (!canUsePostgresRuntime(psql)) {
      console.warn(
        "MANUSXL_DATABASE_PROVIDER=postgres 已设置，但 DATABASE_URL 或 psql CLI 不可用，Context 指标存储回退 SQLite。"
      );
      return createSqliteMetricStore();
    }
    try {
      return createPostgresMetricStore();
    } catch (error) {
      console.warn(
        `PostgreSQL Context 指标存储初始化失败，已回退 SQLite：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return createSqliteMetricStore();
}

function getMetricStore() {
  globalForMetrics.manusxlMetricsStore ??= createMetricStore();
  globalForMetrics.manusxlMetricsStore.ensureSchema();
  return globalForMetrics.manusxlMetricsStore;
}

function estimateTokens(value: string) {
  const cjkChars = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const asciiWords = value.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const symbols = Math.max(0, value.length - cjkChars);
  return Math.max(1, Math.ceil(cjkChars * 1.15 + asciiWords * 1.25 + symbols / 4));
}

function extractStablePrefix(messages: ChatMessage[]) {
  const systemMessage = messages.find((message) => message.role === "system");
  if (!systemMessage) return "";
  const markerIndex = systemMessage.content.indexOf(stablePrefixMarker);
  return markerIndex >= 0 ? systemMessage.content.slice(0, markerIndex) : systemMessage.content;
}

function serializeMessages(messages: ChatMessage[]) {
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function hasSeenPrefix(prefixHash: string, taskId?: string) {
  return getMetricStore().hasSeenPrefix(prefixHash, taskId);
}

function normalizeUsage(value: UsagePayload | undefined) {
  return value ?? {};
}

function positiveTokenCount(value: number | undefined) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : undefined;
}

function cacheReadTokensFromUsage(usage: UsagePayload) {
  return positiveTokenCount(
    usage.cache_read_input_tokens ??
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens
  );
}

function cacheCreationTokensFromUsage(usage: UsagePayload) {
  return positiveTokenCount(usage.cache_creation_input_tokens ?? usage.prompt_cache_miss_tokens);
}

function normalizeMetric(metric: ContextMetric): ContextMetric {
  if (metric.estimatedCostUsd !== undefined && metric.estimatedCostCny !== undefined) {
    return metric;
  }
  const cost = estimateCost({
    model: metric.model,
    promptTokens: metric.promptTokens,
    completionTokens: metric.completionTokens,
    cacheReadTokens: metric.cacheReadTokens
  });
  return {
    ...metric,
    estimatedCostUsd: cost.estimatedCostUsd,
    estimatedCostCny: cost.estimatedCostCny
  };
}

export function recordContextMetric(input: RecordMetricInput) {
  const usage = normalizeUsage(input.usage);
  const messageText = serializeMessages(input.messages);
  const stablePrefix = extractStablePrefix(input.messages);
  const prefixHash = hashText(stablePrefix || messageText.slice(0, 1200));
  const prefixTokens = stablePrefix ? estimateTokens(stablePrefix) : estimateTokens(messageText.slice(0, 1200));
  const promptTokens = usage.prompt_tokens ?? estimateTokens(messageText);
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
  const promptCacheEnabled = input.promptCacheEnabled ?? true;
  const stablePrefixReused = promptCacheEnabled && hasSeenPrefix(prefixHash, input.taskId);
  const providerCacheReadTokens = cacheReadTokensFromUsage(usage);
  const providerCacheCreationTokens = cacheCreationTokensFromUsage(usage);
  const cacheReadTokens =
    promptCacheEnabled && stablePrefixReused
      ? (providerCacheReadTokens ?? Math.min(prefixTokens, promptTokens))
      : 0;
  const cacheCreationTokens =
    promptCacheEnabled
      ? (providerCacheCreationTokens ?? (stablePrefixReused ? 0 : Math.min(prefixTokens, promptTokens)))
      : 0;
  const cacheHitRate = promptTokens > 0 ? Math.min(1, cacheReadTokens / promptTokens) : 0;
  const cost = estimateCost({
    model: input.model,
    promptTokens,
    completionTokens,
    cacheReadTokens
  });
  const createdAt = new Date().toISOString();

  const metric: ContextMetric = {
    id: createId("ctx"),
    taskId: input.taskId,
    stage: input.stage ?? "chat",
    provider: input.provider,
    model: input.model,
    prefixHash,
    prefixTokens,
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheHitRate,
    estimatedCostUsd: cost.estimatedCostUsd,
    estimatedCostCny: cost.estimatedCostCny,
    stablePrefixReused,
    fallbackUsed: input.fallbackUsed,
    latencyMs: input.latencyMs,
    createdAt,
    metadata: input.metadata
  };

  getMetricStore().insertMetric(metric);

  return metric;
}

function readMetrics(taskId?: string, limit = 50) {
  return getMetricStore().readMetrics(taskId, limit);
}

function readAllMetricsForSummary(taskId?: string, ownerId?: string) {
  const metrics = getMetricStore().readAllMetricsForSummary(taskId);
  if (!ownerId) return metrics;
  const taskIds = new Set(listTasks(undefined, ownerId).map((task) => task.id));
  return metrics.filter((metric) => !!metric.taskId && taskIds.has(metric.taskId));
}

export function listContextMetrics(taskId?: string, limit = 50) {
  return readMetrics(taskId, limit);
}

export function listContextMetricsInRange(startIso: string, endIso: string, limit = 5000) {
  return getMetricStore().readMetricsInRange(startIso, endIso, limit);
}

export function getLatestContextMetric(taskId?: string, stage?: string) {
  return getMetricStore().latestMetric(taskId, stage);
}

export function getContextMetricsSummary(taskId?: string, ownerId?: string): ContextMetricsSummary {
  const summaryRows = readAllMetricsForSummary(taskId, ownerId);
  const promptTokens = summaryRows.reduce((sum, metric) => sum + metric.promptTokens, 0);
  const completionTokens = summaryRows.reduce((sum, metric) => sum + metric.completionTokens, 0);
  const cacheReadTokens = summaryRows.reduce((sum, metric) => sum + metric.cacheReadTokens, 0);
  const cacheCreationTokens = summaryRows.reduce((sum, metric) => sum + metric.cacheCreationTokens, 0);
  const estimatedCostUsd = summaryRows.reduce((sum, metric) => sum + (metric.estimatedCostUsd ?? 0), 0);
  const estimatedCostCny = summaryRows.reduce((sum, metric) => sum + (metric.estimatedCostCny ?? 0), 0);
  const noCacheCostUsd = summaryRows.reduce(
    (sum, metric) =>
      sum +
      estimateCost({
        model: metric.model,
        promptTokens: metric.promptTokens,
        completionTokens: metric.completionTokens,
        cacheReadTokens: 0
      }).estimatedCostUsd,
    0
  );
  const noCacheCostCny = summaryRows.reduce(
    (sum, metric) =>
      sum +
      estimateCost({
        model: metric.model,
        promptTokens: metric.promptTokens,
        completionTokens: metric.completionTokens,
        cacheReadTokens: 0
      }).estimatedCostCny,
    0
  );
  const cacheSavingsUsd = Math.max(0, noCacheCostUsd - estimatedCostUsd);
  const cacheSavingsCny = Math.max(0, noCacheCostCny - estimatedCostCny);
  const prefixHashes = new Set(summaryRows.map((metric) => metric.prefixHash));

  return {
    totalCalls: summaryRows.length,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cacheReadTokens,
    cacheCreationTokens,
    averageCacheHitRate: promptTokens > 0 ? cacheReadTokens / promptTokens : 0,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
    estimatedCostCny: Number(estimatedCostCny.toFixed(6)),
    estimatedNoCacheCostUsd: Number(noCacheCostUsd.toFixed(8)),
    estimatedNoCacheCostCny: Number(noCacheCostCny.toFixed(6)),
    estimatedCacheSavingsUsd: Number(cacheSavingsUsd.toFixed(8)),
    estimatedCacheSavingsCny: Number(cacheSavingsCny.toFixed(6)),
    estimatedCacheSavingsRate:
      noCacheCostUsd > 0 ? Number((cacheSavingsUsd / noCacheCostUsd).toFixed(4)) : 0,
    stablePrefixHits: summaryRows.filter((metric) => metric.stablePrefixReused).length,
    prefixInvalidations: Math.max(0, prefixHashes.size - 1),
    latest: summaryRows[0],
    metrics: readMetrics(taskId, 12)
  };
}

export function formatContextMetricForEvent(metric: ContextMetric) {
  const hitRate = Math.round(metric.cacheHitRate * 100);
  const prefixState = metric.stablePrefixReused ? "已复用稳定前缀" : "首次创建稳定前缀";
  const fallback = metric.fallbackUsed ? "，当前为本地回退" : "";
  return `LLM ${metric.stage} 调用完成：输入约 ${metric.promptTokens} tokens，输出约 ${metric.completionTokens} tokens，${prefixState}，缓存友好度 ${hitRate}%，预估成本 $${metric.estimatedCostUsd.toFixed(4)}${fallback}。`;
}

export function exportMetricsSnapshot(taskId?: string) {
  const summary = getContextMetricsSummary(taskId);
  return JSON.stringify(summary, null, 2);
}

export function hasMetricsDatabase() {
  return existsSync(dbFile);
}

export function readMetricsDatabasePath() {
  return dbFile;
}
