import { existsSync } from "node:fs";
import { dataPath } from "@/server/data-root";
import {
  canUsePostgresRuntime,
  checkPsqlCli,
  postgresDatabaseUrl,
  requestedDatabaseProvider,
  runPsql
} from "@/server/db/provider";
import { getManusDb } from "@/server/sqlite";
import type { DatabaseStatus, DatabaseTableCount } from "@/types/agent";

const sqlitePath = dataPath("manusxl.sqlite");
const expectedTables = [
  "users",
  "auth_sessions",
  "tasks",
  "task_steps",
  "task_files",
  "uploaded_files",
  "app_config",
  "mcp_servers",
  "skill_settings",
  "task_templates",
  "context_metrics"
];

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function maskDatabaseUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:\s]+):([^@\s]+)@/, "://$1:****@");
  }
}

function tableExists(db: ReturnType<typeof getManusDb>, table: string) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return Boolean(row);
}

function sqliteTableCounts(): DatabaseTableCount[] {
  if (!existsSync(sqlitePath)) {
    return expectedTables.map((table) => ({ table, rows: 0 }));
  }

  const db = getManusDb();
  return expectedTables.map((table) => {
    if (!tableExists(db, table)) return { table, rows: 0 };
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as {
      count: number;
    };
    return { table, rows: row.count };
  });
}

function checkPostgresSchema(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    return {
      schemaReady: false,
      schemaTableCount: 0,
      error: "未配置 DATABASE_URL"
    };
  }

  const query = `
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${expectedTables.map((table) => `'${table}'`).join(", ")});
  `;
  try {
    const output = runPsql(["-At", "-c", query], { databaseUrl, timeoutMs: 5000 });
    const schemaTableCount = Number(output.trim());
    return {
      schemaReady: schemaTableCount === expectedTables.length,
      schemaTableCount,
      error: undefined
    };
  } catch (error) {
    return {
      schemaReady: false,
      schemaTableCount: 0,
      error: error instanceof Error ? error.message : "无法连接 PostgreSQL"
    };
  }
}

export function getDatabaseStatus(options: { checkPostgres?: boolean } = {}): DatabaseStatus {
  const requestedProvider = requestedDatabaseProvider();
  const databaseUrl = postgresDatabaseUrl();
  const sqliteTables = sqliteTableCounts();
  const psql = checkPsqlCli();
  const activeProvider = canUsePostgresRuntime(psql) ? "postgres" : "sqlite";
  const postgresCheck =
    options.checkPostgres && psql.available
      ? checkPostgresSchema(databaseUrl)
      : {
          schemaReady: undefined,
          schemaTableCount: undefined,
          error: options.checkPostgres && !psql.available ? "本机未找到 psql CLI" : undefined
        };

  return {
    requestedProvider,
    activeProvider,
    runtimePostgresReady: activeProvider === "postgres",
    note:
      activeProvider === "postgres"
      ? "运行时数据会写入 PostgreSQL；SQLite 可作为本地开发回退。"
        : requestedProvider === "postgres"
          ? "已请求 PostgreSQL，但缺少 DATABASE_URL 或 psql CLI，当前回退 SQLite。"
        : "当前开发模式使用 SQLite；PostgreSQL 迁移可先 dry-run 或生成 SQL。",
    sqlite: {
      path: sqlitePath,
      exists: existsSync(sqlitePath),
      tables: sqliteTables,
      totalRows: sqliteTables.reduce((sum, table) => sum + table.rows, 0)
    },
    postgres: {
      configured: Boolean(databaseUrl),
      databaseUrlMasked: maskDatabaseUrl(databaseUrl),
      cliAvailable: psql.available,
      cliSource: psql.source,
      cliVersion: psql.version,
      expectedTableCount: expectedTables.length,
      schemaReady: postgresCheck.schemaReady,
      schemaTableCount: postgresCheck.schemaTableCount,
      error: postgresCheck.error ?? psql.error
    },
    commands: {
      dryRun: "npm run db:pg:dry-run",
      emitSql: "npm run db:pg:emit-sql",
      migrate: "npm run db:pg:migrate"
    }
  };
}
