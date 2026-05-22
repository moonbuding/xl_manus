import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultSqlitePath = join(projectRoot, ".manusxl-data", "manusxl.sqlite");
const defaultSchemaPath = join(projectRoot, "db", "postgres", "0001_initial.sql");

export const migrationTables = [
  {
    name: "users",
    primaryKey: "id",
    jsonColumns: new Set(["data_json"]),
    columns: [
      "id",
      "email",
      "phone",
      "display_name",
      "password_hash",
      "email_verified",
      "verification_code",
      "created_at",
      "updated_at",
      "data_json"
    ]
  },
  {
    name: "tasks",
    primaryKey: "id",
    jsonColumns: new Set(["data_json"]),
    columns: [
      "id",
      "owner_id",
      "prompt",
      "status",
      "model",
      "created_at",
      "updated_at",
      "error",
      "final_answer",
      "data_json"
    ]
  },
  {
    name: "task_steps",
    primaryKey: "id",
    jsonColumns: new Set(["payload_json", "data_json"]),
    columns: [
      "id",
      "task_id",
      "owner_id",
      "type",
      "step_index",
      "title",
      "content",
      "payload_json",
      "created_at",
      "data_json"
    ]
  },
  {
    name: "task_files",
    primaryKey: "id",
    jsonColumns: new Set(["data_json"]),
    columns: [
      "id",
      "task_id",
      "owner_id",
      "filename",
      "file_type",
      "mime_type",
      "path",
      "size",
      "created_at",
      "data_json"
    ]
  },
  {
    name: "uploaded_files",
    primaryKey: "id",
    jsonColumns: new Set(["metadata_json", "data_json"]),
    columns: [
      "id",
      "owner_id",
      "name",
      "mime_type",
      "extension",
      "size",
      "stored_path",
      "text_preview",
      "summary",
      "metadata_json",
      "created_at",
      "data_json"
    ]
  },
  {
    name: "app_config",
    primaryKey: "key",
    jsonColumns: new Set(),
    columns: ["key", "value", "updated_at"]
  },
  {
    name: "mcp_servers",
    primaryKey: "id",
    jsonColumns: new Set(["args_json", "env_json", "tools_json", "data_json"]),
    columns: [
      "id",
      "owner_id",
      "name",
      "type",
      "url",
      "command",
      "args_json",
      "env_json",
      "enabled",
      "status",
      "status_message",
      "tools_json",
      "created_at",
      "updated_at",
      "data_json"
    ]
  },
  {
    name: "skill_settings",
    primaryKey: "id",
    jsonColumns: new Set(),
    columns: ["id", "owner_id", "skill_id", "enabled", "updated_at"]
  },
  {
    name: "task_templates",
    primaryKey: "id",
    jsonColumns: new Set(["tags_json", "data_json"]),
    columns: [
      "id",
      "owner_id",
      "name",
      "description",
      "prompt_template",
      "default_model",
      "tags_json",
      "is_public",
      "created_at",
      "updated_at",
      "data_json"
    ]
  },
  {
    name: "context_metrics",
    primaryKey: "id",
    jsonColumns: new Set(["data_json"]),
    columns: [
      "id",
      "task_id",
      "stage",
      "provider",
      "model",
      "prefix_hash",
      "prefix_tokens",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "cache_read_tokens",
      "cache_creation_tokens",
      "cache_hit_rate",
      "estimated_cost_usd",
      "estimated_cost_cny",
      "stable_prefix_reused",
      "fallback_used",
      "latency_ms",
      "created_at",
      "data_json"
    ]
  }
];

function parseArgs(argv) {
  const args = {
    sqlitePath: defaultSqlitePath,
    schemaPath: defaultSchemaPath,
    dryRun: false,
    emitSqlPath: undefined,
    commit: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sqlite") {
      args.sqlitePath = argv[++index];
    } else if (arg === "--schema") {
      args.schemaPath = argv[++index];
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--emit-sql") {
      args.emitSqlPath = argv[++index];
    } else if (arg === "--commit") {
      args.commit = true;
    } else if (arg === "--help") {
      args.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  if (!args.dryRun && !args.emitSqlPath && !args.commit) {
    args.dryRun = true;
  }

  return args;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.stringify(JSON.parse(String(value)));
  } catch {
    return JSON.stringify({ raw: String(value) });
  }
}

function sqlValue(value, isJson) {
  if (value === null || value === undefined) return "NULL";
  if (isJson) return `${quoteString(normalizeJson(value, "null"))}::jsonb`;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  return quoteString(value);
}

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function openSqlite(sqlitePath) {
  if (!existsSync(sqlitePath)) return undefined;
  return new DatabaseSync(sqlitePath, { readOnly: true });
}

function readRows(db, table) {
  if (!db || !tableExists(db, table.name)) return [];
  return db.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).all();
}

function summarizeRows(sqlitePath) {
  const db = openSqlite(sqlitePath);
  const tables = migrationTables.map((table) => ({
    table: table.name,
    rows: readRows(db, table).length
  }));
  db?.close();
  return {
    sqlitePath,
    sqliteExists: existsSync(sqlitePath),
    tables,
    totalRows: tables.reduce((sum, table) => sum + table.rows, 0)
  };
}

function insertSql(table, row) {
  const columns = table.columns.map(quoteIdentifier).join(", ");
  const values = table.columns
    .map((column) => sqlValue(row[column], table.jsonColumns.has(column)))
    .join(", ");
  const updates = table.columns
    .filter((column) => column !== table.primaryKey)
    .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
    .join(", ");

  return [
    `INSERT INTO ${quoteIdentifier(table.name)} (${columns})`,
    `VALUES (${values})`,
    `ON CONFLICT (${quoteIdentifier(table.primaryKey)}) DO UPDATE SET ${updates};`
  ].join("\n");
}

export function generateMigrationSql(options = {}) {
  const sqlitePath = options.sqlitePath ?? defaultSqlitePath;
  const db = openSqlite(sqlitePath);
  const statements = ["BEGIN;"];
  const tables = [];

  for (const table of migrationTables) {
    const rows = readRows(db, table);
    tables.push({ table: table.name, rows: rows.length });
    for (const row of rows) {
      statements.push(insertSql(table, row));
    }
  }

  db?.close();
  statements.push("COMMIT;");

  return {
    sql: `${statements.join("\n\n")}\n`,
    summary: {
      sqlitePath,
      sqliteExists: existsSync(sqlitePath),
      tables,
      totalRows: tables.reduce((sum, table) => sum + table.rows, 0)
    }
  };
}

export function dryRunMigration(options = {}) {
  return summarizeRows(options.sqlitePath ?? defaultSqlitePath);
}

function runPsql(databaseUrl, args) {
  const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "psql 执行失败").trim());
  }
  return result.stdout.trim();
}

function commitMigration(options) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("commit 模式需要先设置 DATABASE_URL");
  }
  if (!existsSync(options.schemaPath)) {
    throw new Error(`找不到 PostgreSQL schema：${options.schemaPath}`);
  }

  runPsql(databaseUrl, ["-f", options.schemaPath]);
  const tempDir = mkdtempSync(join(tmpdir(), "manusxl-pg-migration-"));
  const sqlPath = join(tempDir, "sqlite-to-postgres.sql");
  try {
    const generated = generateMigrationSql({ sqlitePath: options.sqlitePath });
    writeFileSync(sqlPath, generated.sql);
    runPsql(databaseUrl, ["-f", sqlPath]);
    return generated.summary;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function printHelp() {
  console.log(`
用法：
  node scripts/migrate-sqlite-to-postgres.mjs --dry-run
  node scripts/migrate-sqlite-to-postgres.mjs --emit-sql .manusxl-data/postgres-migration.sql
  DATABASE_URL=postgresql://manusxl:manusxl@localhost:5432/manusxl node scripts/migrate-sqlite-to-postgres.mjs --commit

参数：
  --sqlite <path>    SQLite 源文件，默认 .manusxl-data/manusxl.sqlite
  --schema <path>    PostgreSQL 初始化 SQL，默认 db/postgres/0001_initial.sql
  --dry-run          只统计待迁移行数
  --emit-sql <path>  生成可人工审阅的 INSERT/UPSERT SQL
  --commit           应用 schema 并写入 DATABASE_URL 指向的 PostgreSQL
`.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ mode: "dry-run", ...dryRunMigration(args) }, null, 2));
  }

  if (args.emitSqlPath) {
    const generated = generateMigrationSql(args);
    writeFileSync(args.emitSqlPath, generated.sql);
    console.log(JSON.stringify({ mode: "emit-sql", sqlPath: args.emitSqlPath, ...generated.summary }, null, 2));
  }

  if (args.commit) {
    const summary = commitMigration(args);
    console.log(JSON.stringify({ mode: "commit", ...summary }, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
