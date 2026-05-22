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
import { callStdioMcpTool, listStdioMcpTools } from "@/server/mcp/mcp-client";
import { getManusDb } from "@/server/sqlite";
import type { CreateMcpServerRequest, McpServer } from "@/types/agent";
const allowedCommands = new Set(
  (process.env.MANUSXL_MCP_COMMAND_ALLOWLIST ?? "npx,uvx,node")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);

const globalForMcp = globalThis as unknown as {
  manusxlMcpStore?: McpPersistenceAdapter;
};

interface McpRow {
  data_json: string;
  owner_id: string | null;
}

interface McpPersistenceAdapter {
  provider: "sqlite" | "postgres";
  ensureSchema: () => void;
  claimLegacy: (ownerId?: string) => void;
  listRows: (ownerId?: string) => McpRow[];
  persist: (server: McpServer) => void;
  delete: (serverId: string, ownerId?: string) => boolean;
}

function openMcpDb() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT,
      command TEXT,
      args_json TEXT NOT NULL,
      env_json TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      status_message TEXT NOT NULL,
      tools_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
  `);
  ensureSqliteMcpSchema(db);
  return db;
}

function ensureSqliteMcpSchema(db: DatabaseSync) {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(mcp_servers)").all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );
  if (!columns.has("owner_id")) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN owner_id TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_mcp_servers_owner_id ON mcp_servers(owner_id)");
}

function rowToServer(row: { data_json: string; owner_id?: string | null }) {
  const server = JSON.parse(row.data_json) as McpServer;
  return {
    ...server,
    ownerId: server.ownerId ?? row.owner_id ?? undefined,
    disabledTools: server.disabledTools ?? []
  };
}

export function enabledMcpTools(server: Pick<McpServer, "tools" | "disabledTools">) {
  const disabled = new Set(server.disabledTools ?? []);
  return server.tools.filter((tool) => !disabled.has(tool));
}

function persistServer(server: McpServer) {
  getMcpStore().persist(server);
}

function persistServerSqlite(db: DatabaseSync, server: McpServer) {
  db
    .prepare(
      `
      INSERT INTO mcp_servers
        (id, owner_id, name, type, url, command, args_json, env_json, enabled, status,
         status_message, tools_json, created_at, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        name = excluded.name,
        type = excluded.type,
        url = excluded.url,
        command = excluded.command,
        args_json = excluded.args_json,
        env_json = excluded.env_json,
        enabled = excluded.enabled,
        status = excluded.status,
        status_message = excluded.status_message,
        tools_json = excluded.tools_json,
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
    `
    )
    .run(
      server.id,
      server.ownerId ?? null,
      server.name,
      server.type,
      server.url ?? null,
      server.command ?? null,
      JSON.stringify(server.args),
      JSON.stringify(server.env),
      server.enabled ? 1 : 0,
      server.status,
      server.statusMessage,
      JSON.stringify(server.tools),
      server.createdAt,
      server.updatedAt,
      JSON.stringify(server)
    );
}

function createSqliteMcpStore(): McpPersistenceAdapter {
  const db = openMcpDb();
  return {
    provider: "sqlite",
    ensureSchema: () => ensureSqliteMcpSchema(db),
    claimLegacy: (ownerId) => {
      if (!ownerId) return;
      db.prepare("UPDATE mcp_servers SET owner_id = ? WHERE owner_id IS NULL").run(ownerId);
    },
    listRows: (ownerId) =>
      ownerId
        ? (db
            .prepare("SELECT data_json, owner_id FROM mcp_servers WHERE owner_id = ? ORDER BY datetime(updated_at) DESC")
            .all(ownerId) as unknown as McpRow[])
        : (db
            .prepare("SELECT data_json, owner_id FROM mcp_servers ORDER BY datetime(updated_at) DESC")
            .all() as unknown as McpRow[]),
    persist: (server) => persistServerSqlite(db, server),
    delete: (serverId, ownerId) => {
      const result = ownerId
        ? db.prepare("DELETE FROM mcp_servers WHERE id = ? AND owner_id = ?").run(serverId, ownerId)
        : db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(serverId);
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
  if (!databaseUrl) throw new Error("DATABASE_URL 未配置，无法使用 PostgreSQL MCP 存储");

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

function parseMcpRows(output: string) {
  return output.trim()
    ? output
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as McpRow)
    : [];
}

function selectMcpRowJson() {
  return `
    SELECT json_build_object(
      'data_json', data_json::text,
      'owner_id', owner_id
    )::text
    FROM mcp_servers
  `;
}

function persistServerPostgres(server: McpServer) {
  runPsql([
    "-c",
    `
      INSERT INTO mcp_servers
        (id, owner_id, name, type, url, command, args_json, env_json, enabled, status,
         status_message, tools_json, created_at, updated_at, data_json)
      VALUES (
        ${postgresValue(server.id)},
        ${postgresValue(server.ownerId)},
        ${postgresValue(server.name)},
        ${postgresValue(server.type)},
        ${postgresValue(server.url)},
        ${postgresValue(server.command)},
        ${postgresValue(JSON.stringify(server.args), { json: true })},
        ${postgresValue(JSON.stringify(server.env), { json: true })},
        ${postgresValue(server.enabled ? 1 : 0)},
        ${postgresValue(server.status)},
        ${postgresValue(server.statusMessage)},
        ${postgresValue(JSON.stringify(server.tools), { json: true })},
        ${postgresValue(server.createdAt)},
        ${postgresValue(server.updatedAt)},
        ${postgresValue(JSON.stringify(server), { json: true })}
      )
      ON CONFLICT (id) DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        url = EXCLUDED.url,
        command = EXCLUDED.command,
        args_json = EXCLUDED.args_json,
        env_json = EXCLUDED.env_json,
        enabled = EXCLUDED.enabled,
        status = EXCLUDED.status,
        status_message = EXCLUDED.status_message,
        tools_json = EXCLUDED.tools_json,
        updated_at = EXCLUDED.updated_at,
        data_json = EXCLUDED.data_json;
    `
  ]);
}

function createPostgresMcpStore(): McpPersistenceAdapter {
  ensurePostgresSchema();
  return {
    provider: "postgres",
    ensureSchema: ensurePostgresSchema,
    claimLegacy: (ownerId) => {
      if (!ownerId) return;
      runPsql([
        "-c",
        `
          UPDATE mcp_servers
          SET owner_id = ${postgresValue(ownerId)}
          WHERE owner_id IS NULL;
        `
      ]);
    },
    listRows: (ownerId) => {
      const where = ownerId ? `WHERE owner_id = ${postgresValue(ownerId)}` : "";
      return parseMcpRows(
        runPsql([
          "-At",
          "-c",
          `
            ${selectMcpRowJson()}
            ${where}
            ORDER BY updated_at DESC;
          `
        ])
      );
    },
    persist: persistServerPostgres,
    delete: (serverId, ownerId) => {
      const where = ownerId
        ? `id = ${postgresValue(serverId)} AND owner_id = ${postgresValue(ownerId)}`
        : `id = ${postgresValue(serverId)}`;
      const output = runPsql([
        "-At",
        "-c",
        `
          WITH deleted AS (
            DELETE FROM mcp_servers
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

function createMcpStore(): McpPersistenceAdapter {
  const requestedProvider = requestedDatabaseProvider();
  if (requestedProvider === "postgres") {
    const psql = checkPsqlCli();
    if (!canUsePostgresRuntime(psql)) {
      console.warn(
        "MANUSXL_DATABASE_PROVIDER=postgres 已设置，但 DATABASE_URL 或 psql CLI 不可用，MCP 存储回退 SQLite。"
      );
      return createSqliteMcpStore();
    }
    try {
      return createPostgresMcpStore();
    } catch (error) {
      console.warn(
        `PostgreSQL MCP 存储初始化失败，已回退 SQLite：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return createSqliteMcpStore();
}

function getMcpStore() {
  globalForMcp.manusxlMcpStore ??= createMcpStore();
  globalForMcp.manusxlMcpStore.ensureSchema();
  return globalForMcp.manusxlMcpStore;
}

function claimLegacyMcpServers(ownerId?: string) {
  getMcpStore().claimLegacy(ownerId);
}

function parseArgs(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function parseEnv(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /^[A-Z_][A-Z0-9_]*$/i.test(key))
      .map(([key, item]) => [key, String(item)])
  );
}

function inferTools(input: CreateMcpServerRequest) {
  const joined = `${input.name} ${input.url ?? ""} ${input.command ?? ""} ${parseArgs(input.args).join(" ")}`.toLowerCase();
  if (/filesystem|file|目录|文件/.test(joined)) return ["list_directory", "read_file", "search_files"];
  if (/github|repo|pull|issue/.test(joined)) return ["list_repositories", "read_issue", "inspect_pull_request"];
  if (/slack/.test(joined)) return ["search_messages", "post_message"];
  if (/notion/.test(joined)) return ["search_pages", "read_page"];
  return ["list_tools"];
}

async function validateSseServer(urlValue: string) {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("MCP SSE URL 格式不正确");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("MCP SSE URL 只允许 http/https");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "text/event-stream, application/json, text/plain"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function validateStdioServer(command: string | undefined) {
  const normalized = command?.trim();
  if (!normalized) throw new Error("stdio MCP 需要填写 command");
  if (!allowedCommands.has(normalized)) {
    throw new Error(`command ${normalized} 不在 allowlist 中，当前允许：${Array.from(allowedCommands).join("、")}`);
  }
}

function getMcpServer(serverId: string, ownerId?: string) {
  return listMcpServers(ownerId).find((server) => server.id === serverId);
}

export function listMcpServers(ownerId?: string) {
  claimLegacyMcpServers(ownerId);
  return getMcpStore().listRows(ownerId).map(rowToServer);
}

export function listEnabledMcpServers(ownerId?: string) {
  return listMcpServers(ownerId).filter((server) => server.enabled && server.status !== "blocked");
}

export async function createMcpServer(input: Partial<CreateMcpServerRequest>, ownerId?: string) {
  const type = input.type === "stdio" ? "stdio" : "sse";
  const args = parseArgs(input.args);
  const env = parseEnv(input.env);
  const now = new Date().toISOString();

  if (type === "sse") {
    if (!input.url?.trim()) throw new Error("SSE MCP 需要填写 URL");
    await validateSseServer(input.url.trim());
  } else {
    validateStdioServer(input.command);
  }

  const discoveredTools =
    type === "stdio"
      ? await listStdioMcpTools({
          command: input.command?.trim() ?? "",
          args,
          env
        })
      : [];

  const server: McpServer = {
    id: createId("mcp"),
    ownerId,
    name: input.name?.trim() || "未命名 MCP",
    type,
    url: type === "sse" ? input.url?.trim() : undefined,
    command: type === "stdio" ? input.command?.trim() : undefined,
    args,
    env,
    enabled: true,
    status: "healthy",
    statusMessage:
      type === "sse"
        ? "连接检查通过"
        : `list_tools 成功，发现 ${discoveredTools.length} 个工具`,
    tools:
      discoveredTools.length > 0
        ? discoveredTools.map((tool) => tool.name)
        : inferTools(input as CreateMcpServerRequest),
    disabledTools: [],
    createdAt: now,
    updatedAt: now
  };

  persistServer(server);
  return server;
}

export async function refreshMcpServerTools(serverId: string, ownerId?: string) {
  const server = getMcpServer(serverId, ownerId);
  if (!server) return undefined;

  if (server.type === "sse") {
    if (server.url) await validateSseServer(server.url);
    const next = {
      ...server,
      status: "healthy" as const,
      statusMessage: "连接检查通过；SSE list_tools 待接入",
      updatedAt: new Date().toISOString()
    };
    persistServer(next);
    return next;
  }

  try {
    const tools = await listStdioMcpTools({
      command: server.command ?? "",
      args: server.args,
      env: server.env
    });
    const next = {
      ...server,
      status: "healthy" as const,
      statusMessage: `list_tools 成功，发现 ${tools.length} 个工具`,
      tools: tools.map((tool) => tool.name),
      disabledTools: (server.disabledTools ?? []).filter((tool) =>
        tools.some((candidate) => candidate.name === tool)
      ),
      updatedAt: new Date().toISOString()
    };
    persistServer(next);
    return next;
  } catch (error) {
    const next = {
      ...server,
      status: "failed" as const,
      statusMessage: error instanceof Error ? error.message.slice(0, 500) : "MCP list_tools 失败",
      updatedAt: new Date().toISOString()
    };
    persistServer(next);
    return next;
  }
}

export async function callMcpServerTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  ownerId?: string
) {
  const server = getMcpServer(serverId, ownerId);
  if (!server || !server.enabled || server.status === "blocked") {
    throw new Error("MCP Server 不存在、未启用或已被阻止。");
  }
  if (server.type !== "stdio") {
    throw new Error("当前版本仅支持 stdio MCP 工具调用；SSE 调用后续接入。");
  }
  if (!enabledMcpTools(server).includes(toolName)) {
    throw new Error(`MCP Server ${server.name} 未声明工具 ${toolName}，或该工具已被禁用。`);
  }

  return callStdioMcpTool(
    {
      command: server.command ?? "",
      args: server.args,
      env: server.env
    },
    toolName,
    args
  );
}

export function updateMcpServerToolEnabled(
  serverId: string,
  toolName: string,
  enabled: boolean,
  ownerId?: string
) {
  const server = getMcpServer(serverId, ownerId);
  if (!server || !server.tools.includes(toolName)) return undefined;

  const disabled = new Set(server.disabledTools ?? []);
  if (enabled) {
    disabled.delete(toolName);
  } else {
    disabled.add(toolName);
  }

  const next = {
    ...server,
    disabledTools: [...disabled],
    updatedAt: new Date().toISOString()
  };
  persistServer(next);
  return next;
}

export function updateMcpServerEnabled(serverId: string, enabled: boolean, ownerId?: string) {
  const server = listMcpServers(ownerId).find((item) => item.id === serverId);
  if (!server) return undefined;
  const next = {
    ...server,
    enabled,
    updatedAt: new Date().toISOString()
  };
  persistServer(next);
  return next;
}

export function deleteMcpServer(serverId: string, ownerId?: string) {
  claimLegacyMcpServers(ownerId);
  return getMcpStore().delete(serverId, ownerId);
}
