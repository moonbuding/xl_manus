import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "@/server/data-root";
import {
  canUsePostgresRuntime,
  checkPsqlCli,
  requestedDatabaseProvider,
  runPsql
} from "@/server/db/provider";
import { getManusDb } from "@/server/sqlite";

export interface StoredAppConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxSteps?: number;
  taskBudgetUsd?: number;
  planningModel?: string;
  executionModel?: string;
  finalModel?: string;
  promptCacheEnabled?: boolean;
  localBrowserDomainAllowlist?: string[];
  localBrowserPaused?: boolean;
  myComputerAllowedRoots?: string[];
  myComputerPaused?: boolean;
}

const secretFile = dataPath("config-secret");
const encryptedPrefix = "enc:v1:";

interface ConfigPersistenceAdapter {
  provider: "sqlite" | "postgres";
  ensureSchema: () => void;
  get: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
}

const globalForConfig = globalThis as unknown as {
  manusxlConfigStore?: ConfigPersistenceAdapter;
};

function openConfigDb() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function getConfigValueSqlite(db: DatabaseSync, key: string) {
  const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function setConfigValueSqlite(db: DatabaseSync, key: string, value: string) {
  db.prepare(`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

function createSqliteConfigStore(): ConfigPersistenceAdapter {
  const db = openConfigDb();
  return {
    provider: "sqlite",
    ensureSchema: () => {
      openConfigDb();
    },
    get: (key) => getConfigValueSqlite(db, key),
    set: (key, value) => setConfigValueSqlite(db, key, value)
  };
}

function postgresSchemaPath() {
  return `${process.cwd()}/db/postgres/0001_initial.sql`;
}

function quotePostgresString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function postgresValue(value: string | undefined | null) {
  return value === undefined || value === null ? "NULL" : quotePostgresString(value);
}

function ensurePostgresSchema() {
  const schemaPath = postgresSchemaPath();
  if (!existsSync(schemaPath)) {
    throw new Error(`找不到 PostgreSQL schema：${schemaPath}`);
  }
  runPsql(["-f", schemaPath]);
}

function createPostgresConfigStore(): ConfigPersistenceAdapter {
  ensurePostgresSchema();
  return {
    provider: "postgres",
    ensureSchema: ensurePostgresSchema,
    get: (key) => {
      const output = runPsql([
        "-At",
        "-c",
        `
          SELECT value
          FROM app_config
          WHERE key = ${postgresValue(key)}
          LIMIT 1;
        `
      ]);
      return output.trim() || undefined;
    },
    set: (key, value) => {
      runPsql([
        "-c",
        `
          INSERT INTO app_config (key, value, updated_at)
          VALUES (${postgresValue(key)}, ${postgresValue(value)}, ${postgresValue(new Date().toISOString())})
          ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = EXCLUDED.updated_at;
        `
      ]);
    }
  };
}

function createConfigStore(): ConfigPersistenceAdapter {
  const requestedProvider = requestedDatabaseProvider();
  if (requestedProvider === "postgres") {
    const psql = checkPsqlCli();
    if (!canUsePostgresRuntime(psql)) {
      console.warn(
        "MANUSXL_DATABASE_PROVIDER=postgres 已设置，但 DATABASE_URL 或 psql CLI 不可用，配置存储回退 SQLite。"
      );
      return createSqliteConfigStore();
    }
    try {
      return createPostgresConfigStore();
    } catch (error) {
      console.warn(
        `PostgreSQL 配置存储初始化失败，已回退 SQLite：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return createSqliteConfigStore();
}

function getConfigStore() {
  globalForConfig.manusxlConfigStore ??= createConfigStore();
  globalForConfig.manusxlConfigStore.ensureSchema();
  return globalForConfig.manusxlConfigStore;
}

function getEncryptionKey() {
  mkdirSync(dirname(secretFile), { recursive: true });
  const envSecret = process.env.MANUSXL_CONFIG_SECRET;
  if (envSecret) {
    return createHash("sha256").update(envSecret).digest();
  }
  if (!existsSync(secretFile)) {
    writeFileSync(secretFile, randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return createHash("sha256").update(readFileSync(secretFile, "utf8")).digest();
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${encryptedPrefix}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(value: string | undefined) {
  if (!value) return undefined;
  if (!value.startsWith(encryptedPrefix)) return value;

  const [ivBase64, tagBase64, encryptedBase64] = value.slice(encryptedPrefix.length).split(":");
  if (!ivBase64 || !tagBase64 || !encryptedBase64) return undefined;

  try {
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivBase64, "base64"));
    decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return undefined;
  }
}

function normalizeDomainAllowlist(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : (value ?? "").split(/[\n,]/);
  const domains = values
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => {
      try {
        if (/^https?:\/\//.test(item)) return new URL(item).hostname.toLowerCase();
      } catch {
        return item;
      }
      return item;
    })
    .map((item) => item.replace(/^\*\./, "").replace(/^\.+/, "").replace(/\.+$/, ""))
    .filter((item) => /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(item));
  return Array.from(new Set(domains)).slice(0, 80);
}

function readStoredDomainAllowlist(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return normalizeDomainAllowlist(parsed.map(String));
  } catch {
    return normalizeDomainAllowlist(value);
  }
  return normalizeDomainAllowlist(value);
}

function normalizeFilesystemRoots(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : (value ?? "").split(/[\n,]/);
  return Array.from(
    new Set(
      values
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.replace(/^~(?=$|\/|\\)/, process.env.HOME ?? "~"))
    )
  ).slice(0, 12);
}

function readStoredFilesystemRoots(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return normalizeFilesystemRoots(parsed.map(String));
  } catch {
    return normalizeFilesystemRoots(value);
  }
  return normalizeFilesystemRoots(value);
}

export function getStoredAppConfig(): StoredAppConfig {
  const store = getConfigStore();
  const temperature = Number(store.get("runtime.temperature"));
  const maxSteps = Number(store.get("runtime.maxSteps"));
  const taskBudgetUsd = Number(store.get("runtime.taskBudgetUsd"));
  const promptCacheEnabled = store.get("runtime.promptCacheEnabled");
  const localBrowserPaused = store.get("localBrowser.paused");
  const myComputerPaused = store.get("myComputer.paused");
  const myComputerAllowedRoots = readStoredFilesystemRoots(store.get("myComputer.allowedRoots"));
  const localBrowserDomainAllowlist = readStoredDomainAllowlist(
    store.get("localBrowser.domainAllowlist")
  );
  return {
    apiKey: decryptSecret(store.get("deepseek.apiKey")),
    model: store.get("deepseek.model"),
    baseUrl: store.get("deepseek.baseUrl"),
    temperature: Number.isFinite(temperature) ? temperature : undefined,
    maxSteps: Number.isFinite(maxSteps) ? maxSteps : undefined,
    taskBudgetUsd: Number.isFinite(taskBudgetUsd) ? taskBudgetUsd : undefined,
    planningModel: store.get("modelRouter.planningModel"),
    executionModel: store.get("modelRouter.executionModel"),
    finalModel: store.get("modelRouter.finalModel"),
    promptCacheEnabled:
      promptCacheEnabled === undefined ? undefined : promptCacheEnabled === "true",
    localBrowserDomainAllowlist,
    localBrowserPaused: localBrowserPaused === undefined ? undefined : localBrowserPaused === "true",
    myComputerAllowedRoots,
    myComputerPaused: myComputerPaused === undefined ? undefined : myComputerPaused === "true"
  };
}

export function getAppConfig() {
  const stored = getStoredAppConfig();
  const envLocalBrowserDomainAllowlist = normalizeDomainAllowlist(
    process.env.MANUSXL_LOCAL_BROWSER_DOMAIN_ALLOWLIST
  );
  const envMyComputerAllowedRoots = normalizeFilesystemRoots(
    process.env.MANUSXL_MY_COMPUTER_ALLOWED_ROOTS
  );
  return {
    apiKey: stored.apiKey || process.env.DEEPSEEK_API_KEY,
    model: stored.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    baseUrl: stored.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    temperature: stored.temperature ?? Number(process.env.MANUSXL_TEMPERATURE ?? 0.35),
    maxSteps: stored.maxSteps ?? Number(process.env.MANUSXL_MAX_STEPS ?? 6),
    taskBudgetUsd: stored.taskBudgetUsd ?? Number(process.env.MANUSXL_TASK_BUDGET_USD ?? 1),
    planningModel:
      stored.planningModel || process.env.MANUSXL_PLANNING_MODEL || stored.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    executionModel:
      stored.executionModel || process.env.MANUSXL_EXECUTION_MODEL || stored.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    finalModel:
      stored.finalModel || process.env.MANUSXL_FINAL_MODEL || stored.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    promptCacheEnabled:
      stored.promptCacheEnabled ?? process.env.MANUSXL_PROMPT_CACHE_ENABLED !== "false",
    localBrowserDomainAllowlist:
      stored.localBrowserDomainAllowlist && stored.localBrowserDomainAllowlist.length > 0
        ? stored.localBrowserDomainAllowlist
        : envLocalBrowserDomainAllowlist,
    localBrowserPaused: stored.localBrowserPaused ?? process.env.MANUSXL_LOCAL_BROWSER_PAUSED === "true",
    myComputerAllowedRoots:
      stored.myComputerAllowedRoots && stored.myComputerAllowedRoots.length > 0
        ? stored.myComputerAllowedRoots
        : envMyComputerAllowedRoots,
    myComputerPaused: stored.myComputerPaused ?? process.env.MANUSXL_MY_COMPUTER_PAUSED === "true"
  };
}

export function getLocalBrowserDomainAllowlist() {
  return getAppConfig().localBrowserDomainAllowlist;
}

export function isLocalBrowserPaused() {
  return getAppConfig().localBrowserPaused;
}

export function getMyComputerAllowedRoots() {
  return getAppConfig().myComputerAllowedRoots;
}

export function isMyComputerPaused() {
  return getAppConfig().myComputerPaused;
}

export function updateAppConfig(config: StoredAppConfig) {
  const store = getConfigStore();
  if (config.apiKey !== undefined) {
    const trimmed = config.apiKey.trim();
    if (trimmed) {
      store.set("deepseek.apiKey", encryptSecret(trimmed));
    }
  }
  if (config.model !== undefined) {
    store.set("deepseek.model", config.model.trim());
  }
  if (config.baseUrl !== undefined) {
    store.set("deepseek.baseUrl", config.baseUrl.trim());
  }
  if (config.temperature !== undefined && Number.isFinite(config.temperature)) {
    store.set("runtime.temperature", String(Math.min(1, Math.max(0, config.temperature))));
  }
  if (config.maxSteps !== undefined && Number.isFinite(config.maxSteps)) {
    store.set("runtime.maxSteps", String(Math.min(12, Math.max(3, Math.round(config.maxSteps)))));
  }
  if (config.taskBudgetUsd !== undefined && Number.isFinite(config.taskBudgetUsd)) {
    store.set("runtime.taskBudgetUsd", String(Math.max(0, config.taskBudgetUsd)));
  }
  if (config.planningModel !== undefined) {
    store.set("modelRouter.planningModel", config.planningModel.trim());
  }
  if (config.executionModel !== undefined) {
    store.set("modelRouter.executionModel", config.executionModel.trim());
  }
  if (config.finalModel !== undefined) {
    store.set("modelRouter.finalModel", config.finalModel.trim());
  }
  if (config.promptCacheEnabled !== undefined) {
    store.set("runtime.promptCacheEnabled", String(config.promptCacheEnabled));
  }
  if (config.localBrowserDomainAllowlist !== undefined) {
    store.set(
      "localBrowser.domainAllowlist",
      JSON.stringify(normalizeDomainAllowlist(config.localBrowserDomainAllowlist))
    );
  }
  if (config.localBrowserPaused !== undefined) {
    store.set("localBrowser.paused", String(config.localBrowserPaused));
  }
  if (config.myComputerAllowedRoots !== undefined) {
    store.set(
      "myComputer.allowedRoots",
      JSON.stringify(normalizeFilesystemRoots(config.myComputerAllowedRoots))
    );
  }
  if (config.myComputerPaused !== undefined) {
    store.set("myComputer.paused", String(config.myComputerPaused));
  }
  return getAppConfig();
}
