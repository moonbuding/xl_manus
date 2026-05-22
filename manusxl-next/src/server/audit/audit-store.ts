import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createId } from "@/lib/id";
import {
  canUsePostgresRuntime,
  checkPsqlCli,
  requestedDatabaseProvider,
  runPsql
} from "@/server/db/provider";
import { getManusDb } from "@/server/sqlite";
import type { AuditLog, AuditLogStatus, AuditVerifyResult } from "@/types/agent";

const genesisHash = "audit_genesis";
const auditStoreVersion = 2;
const sensitiveKeyPattern = /api.?key|token|secret|password|verification.?code|refresh|authorization/i;

interface AuditStore {
  version: number;
  provider: "sqlite" | "postgres";
  ensureSchema: () => void;
  insert: (log: AuditLog) => void;
  latestHash: (userId?: string) => string | undefined;
  list: (input: AuditLogQuery) => AuditLogListResult;
  readChain: (userId?: string) => AuditLog[];
}

export interface AuditLogQuery {
  userId?: string;
  taskId?: string;
  action?: string;
  status?: AuditLogStatus;
  limit?: number;
  offset?: number;
}

export interface AuditLogListResult {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface RecordAuditLogInput {
  userId?: string;
  taskId?: string;
  stepId?: string;
  action: string;
  resource?: string;
  status?: AuditLogStatus;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

const globalForAudit = globalThis as unknown as {
  manusxlAuditStore?: AuditStore;
  manusxlAuditLatestHashes?: Map<string, string>;
};

function sha256(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sanitizeMetadata(value: Record<string, unknown> = {}) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[redacted]" : sanitizeMetadataValue(item)
    ])
  );
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeMetadataValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sensitiveKeyPattern.test(key) ? "[redacted]" : sanitizeMetadataValue(item)
      ])
    );
  }
  if (typeof value === "string") return value.length > 1000 ? `${value.slice(0, 1000)}...` : value;
  return value;
}

function entryHashPayload(log: Omit<AuditLog, "entryHash">) {
  return {
    id: log.id,
    userId: log.userId ?? null,
    taskId: log.taskId ?? null,
    stepId: log.stepId ?? null,
    action: log.action,
    resource: log.resource,
    status: log.status,
    ip: log.ip ?? null,
    userAgent: log.userAgent ?? null,
    metadataHash: log.metadataHash,
    previousHash: log.previousHash,
    createdAt: log.createdAt
  };
}

export function computeAuditEntryHash(log: Omit<AuditLog, "entryHash">) {
  return sha256(entryHashPayload(log));
}

function quotePostgresString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function postgresValue(value: unknown, options: { json?: boolean } = {}) {
  if (value === undefined || value === null) return "NULL";
  if (options.json) return `${quotePostgresString(JSON.stringify(value))}::jsonb`;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return quotePostgresString(String(value));
}

function rowToAuditLog(row: Record<string, unknown>): AuditLog {
  const metadataValue = row.metadata_json;
  const metadata =
    typeof metadataValue === "string"
      ? JSON.parse(metadataValue)
      : metadataValue && typeof metadataValue === "object"
        ? metadataValue as Record<string, unknown>
        : {};
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : undefined,
    taskId: row.task_id ? String(row.task_id) : undefined,
    stepId: row.step_id ? String(row.step_id) : undefined,
    action: String(row.action),
    resource: String(row.resource),
    status: String(row.status) as AuditLogStatus,
    ip: row.ip ? String(row.ip) : undefined,
    userAgent: row.user_agent ? String(row.user_agent) : undefined,
    metadata,
    metadataHash: String(row.metadata_hash),
    previousHash: String(row.previous_hash),
    entryHash: String(row.entry_hash),
    createdAt: String(row.created_at)
  };
}

function sqliteSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      task_id TEXT,
      step_id TEXT,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      status TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      metadata_json TEXT NOT NULL,
      metadata_hash TEXT NOT NULL,
      previous_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_task_id ON audit_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

    CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'audit_logs are append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'audit_logs are append-only');
    END;
  `);
}

function createSqliteAuditStore(): AuditStore {
  const db = getManusDb();
  sqliteSchema(db);
  return {
    version: auditStoreVersion,
    provider: "sqlite",
    ensureSchema: () => sqliteSchema(db),
    insert: (log) => {
      db.prepare(`
        INSERT INTO audit_logs
          (id, user_id, task_id, step_id, action, resource, status, ip, user_agent,
           metadata_json, metadata_hash, previous_hash, entry_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        log.id,
        log.userId ?? null,
        log.taskId ?? null,
        log.stepId ?? null,
        log.action,
        log.resource,
        log.status,
        log.ip ?? null,
        log.userAgent ?? null,
        JSON.stringify(log.metadata),
        log.metadataHash,
        log.previousHash,
        log.entryHash,
        log.createdAt
      );
    },
    latestHash: (userId) => {
      const row = db
        .prepare(`
          SELECT entry_hash FROM audit_logs
          WHERE user_id IS ?
          ORDER BY rowid DESC
          LIMIT 1
        `)
        .get(userId ?? null) as { entry_hash?: string } | undefined;
      return row?.entry_hash;
    },
    list: (input) => {
      const conditions: string[] = [];
      const params: Array<string | number | null> = [];
      if (input.userId !== undefined) {
        conditions.push("user_id = ?");
        params.push(input.userId);
      }
      if (input.taskId) {
        conditions.push("task_id = ?");
        params.push(input.taskId);
      }
      if (input.action) {
        conditions.push("action = ?");
        params.push(input.action);
      }
      if (input.status) {
        conditions.push("status = ?");
        params.push(input.status);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
      const offset = Math.max(0, input.offset ?? 0);
      const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`).get(...params) as {
        count: number;
      };
      const rows = db
        .prepare(`
          SELECT * FROM audit_logs
          ${where}
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT ? OFFSET ?
        `)
        .all(...params, limit, offset) as Array<Record<string, unknown>>;
      return { logs: rows.map(rowToAuditLog), total: total.count, limit, offset };
    },
    readChain: (userId) => {
      const rows = db
        .prepare(`
          SELECT * FROM audit_logs
          WHERE user_id IS ?
          ORDER BY rowid ASC
        `)
        .all(userId ?? null) as Array<Record<string, unknown>>;
      return rows.map(rowToAuditLog);
    }
  };
}

function postgresSchemaPath() {
  return join(process.cwd(), "db", "postgres", "0001_initial.sql");
}

function ensurePostgresAuditSchema() {
  if (existsSync(postgresSchemaPath())) runPsql(["-f", postgresSchemaPath()]);
}

function auditLogInsertSql(log: AuditLog) {
  return `
    INSERT INTO audit_logs
      (id, user_id, task_id, step_id, action, resource, status, ip, user_agent,
       metadata_json, metadata_hash, previous_hash, entry_hash, created_at)
    VALUES (
      ${postgresValue(log.id)},
      ${postgresValue(log.userId)},
      ${postgresValue(log.taskId)},
      ${postgresValue(log.stepId)},
      ${postgresValue(log.action)},
      ${postgresValue(log.resource)},
      ${postgresValue(log.status)},
      ${postgresValue(log.ip)},
      ${postgresValue(log.userAgent)},
      ${postgresValue(log.metadata, { json: true })},
      ${postgresValue(log.metadataHash)},
      ${postgresValue(log.previousHash)},
      ${postgresValue(log.entryHash)},
      ${postgresValue(log.createdAt)}
    );
  `;
}

function postgresWhere(input: AuditLogQuery) {
  const conditions: string[] = [];
  if (input.userId !== undefined) conditions.push(`user_id = ${postgresValue(input.userId)}`);
  if (input.taskId) conditions.push(`task_id = ${postgresValue(input.taskId)}`);
  if (input.action) conditions.push(`action = ${postgresValue(input.action)}`);
  if (input.status) conditions.push(`status = ${postgresValue(input.status)}`);
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

function createPostgresAuditStore(): AuditStore {
  ensurePostgresAuditSchema();
  return {
    version: auditStoreVersion,
    provider: "postgres",
    ensureSchema: ensurePostgresAuditSchema,
    insert: (log) => {
      runPsql(["-c", auditLogInsertSql(log)]);
    },
    latestHash: (userId) => {
      const output = runPsql([
        "-At",
        "-c",
        `
          SELECT entry_hash FROM audit_logs
          WHERE user_id IS NOT DISTINCT FROM ${postgresValue(userId)}
          ORDER BY created_at DESC, id DESC
          LIMIT 1;
        `
      ]);
      return output.trim() || undefined;
    },
    list: (input) => {
      const where = postgresWhere(input);
      const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
      const offset = Math.max(0, input.offset ?? 0);
      const totalOutput = runPsql(["-At", "-c", `SELECT COUNT(*) FROM audit_logs ${where};`]);
      const output = runPsql([
        "-At",
        "-c",
        `
          SELECT row_to_json(a)::text
          FROM (
            SELECT * FROM audit_logs
            ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ${limit} OFFSET ${offset}
          ) a;
        `
      ]);
      const logs = output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => rowToAuditLog(JSON.parse(line) as Record<string, unknown>));
      return { logs, total: Number(totalOutput.trim() || 0), limit, offset };
    },
    readChain: (userId) => {
      const output = runPsql([
        "-At",
        "-c",
        `
          SELECT row_to_json(a)::text
          FROM (
            SELECT * FROM audit_logs
            WHERE user_id IS NOT DISTINCT FROM ${postgresValue(userId)}
            ORDER BY created_at ASC, id ASC
          ) a;
        `
      ]);
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => rowToAuditLog(JSON.parse(line) as Record<string, unknown>));
    }
  };
}

function createAuditStore(): AuditStore {
  if (requestedDatabaseProvider() === "postgres") {
    const psql = checkPsqlCli();
    if (canUsePostgresRuntime(psql)) {
      try {
        return createPostgresAuditStore();
      } catch (error) {
        console.warn(
          `PostgreSQL 审计日志初始化失败，已回退 SQLite：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  return createSqliteAuditStore();
}

function getAuditStore() {
  const existing = globalForAudit.manusxlAuditStore;
  if (existing?.version === auditStoreVersion) {
    existing.ensureSchema();
    return existing;
  }
  const store = createAuditStore();
  globalForAudit.manusxlAuditStore = store;
  return store;
}

export function recordAuditLog(input: RecordAuditLogInput) {
  const store = getAuditStore();
  globalForAudit.manusxlAuditLatestHashes ??= new Map<string, string>();
  const chainKey = input.userId ?? "__system__";
  const createdAt = new Date().toISOString();
  const metadata = sanitizeMetadata(input.metadata);
  const previousHash =
    globalForAudit.manusxlAuditLatestHashes.get(chainKey) ??
    store.latestHash(input.userId) ??
    genesisHash;
  const base: Omit<AuditLog, "entryHash"> = {
    id: createId("audit"),
    userId: input.userId,
    taskId: input.taskId,
    stepId: input.stepId,
    action: input.action.trim(),
    resource: input.resource?.trim() || "system",
    status: input.status ?? "completed",
    ip: input.ip,
    userAgent: input.userAgent,
    metadata,
    metadataHash: sha256(metadata),
    previousHash,
    createdAt
  };
  const log: AuditLog = {
    ...base,
    entryHash: computeAuditEntryHash(base)
  };
  store.insert(log);
  globalForAudit.manusxlAuditLatestHashes.set(chainKey, log.entryHash);
  return log;
}

export function safeRecordAuditLog(input: RecordAuditLogInput) {
  try {
    return recordAuditLog(input);
  } catch (error) {
    console.warn(`审计日志写入失败：${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function listAuditLogs(input: AuditLogQuery = {}) {
  return getAuditStore().list(input);
}

export function verifyAuditChain(userId?: string): AuditVerifyResult {
  const logs = getAuditStore().readChain(userId);
  let previousHash = genesisHash;
  for (const log of logs) {
    if (log.previousHash !== previousHash) {
      return {
        ok: false,
        total: logs.length,
        checkedAt: new Date().toISOString(),
        firstHash: logs[0]?.entryHash,
        lastHash: logs.at(-1)?.entryHash,
        brokenAt: log.id,
        error: "previous_hash 不连续"
      };
    }
    const base = { ...log };
    delete (base as Partial<AuditLog>).entryHash;
    const expected = computeAuditEntryHash(base);
    if (expected !== log.entryHash) {
      return {
        ok: false,
        total: logs.length,
        checkedAt: new Date().toISOString(),
        firstHash: logs[0]?.entryHash,
        lastHash: logs.at(-1)?.entryHash,
        brokenAt: log.id,
        error: "entry_hash 校验失败"
      };
    }
    previousHash = log.entryHash;
  }

  return {
    ok: true,
    total: logs.length,
    checkedAt: new Date().toISOString(),
    firstHash: logs[0]?.entryHash,
    lastHash: logs.at(-1)?.entryHash
  };
}

export function requestAuditContext(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || request.headers.get("x-real-ip") || undefined,
    userAgent: request.headers.get("user-agent") || undefined
  };
}

export function auditLogsToCsv(logs: AuditLog[]) {
  const columns = [
    "id",
    "userId",
    "taskId",
    "stepId",
    "action",
    "resource",
    "status",
    "ip",
    "createdAt",
    "metadataHash",
    "previousHash",
    "entryHash"
  ] as const;
  const escape = (value: unknown) => {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    columns.join(","),
    ...logs.map((log) => columns.map((column) => escape(log[column])).join(","))
  ].join("\n");
}
