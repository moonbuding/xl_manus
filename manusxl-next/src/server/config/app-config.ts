import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "@/server/data-root";
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
}

const secretFile = dataPath("config-secret");
const encryptedPrefix = "enc:v1:";

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

function getConfigValue(db: DatabaseSync, key: string) {
  const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function setConfigValue(db: DatabaseSync, key: string, value: string) {
  db.prepare(`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
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

export function getStoredAppConfig(): StoredAppConfig {
  const db = openConfigDb();
  const temperature = Number(getConfigValue(db, "runtime.temperature"));
  const maxSteps = Number(getConfigValue(db, "runtime.maxSteps"));
  const taskBudgetUsd = Number(getConfigValue(db, "runtime.taskBudgetUsd"));
  const promptCacheEnabled = getConfigValue(db, "runtime.promptCacheEnabled");
  return {
    apiKey: decryptSecret(getConfigValue(db, "deepseek.apiKey")),
    model: getConfigValue(db, "deepseek.model"),
    baseUrl: getConfigValue(db, "deepseek.baseUrl"),
    temperature: Number.isFinite(temperature) ? temperature : undefined,
    maxSteps: Number.isFinite(maxSteps) ? maxSteps : undefined,
    taskBudgetUsd: Number.isFinite(taskBudgetUsd) ? taskBudgetUsd : undefined,
    planningModel: getConfigValue(db, "modelRouter.planningModel"),
    executionModel: getConfigValue(db, "modelRouter.executionModel"),
    finalModel: getConfigValue(db, "modelRouter.finalModel"),
    promptCacheEnabled:
      promptCacheEnabled === undefined ? undefined : promptCacheEnabled === "true"
  };
}

export function getAppConfig() {
  const stored = getStoredAppConfig();
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
      stored.promptCacheEnabled ?? process.env.MANUSXL_PROMPT_CACHE_ENABLED !== "false"
  };
}

export function updateAppConfig(config: StoredAppConfig) {
  const db = openConfigDb();
  if (config.apiKey !== undefined) {
    const trimmed = config.apiKey.trim();
    if (trimmed) {
      setConfigValue(db, "deepseek.apiKey", encryptSecret(trimmed));
    }
  }
  if (config.model !== undefined) {
    setConfigValue(db, "deepseek.model", config.model.trim());
  }
  if (config.baseUrl !== undefined) {
    setConfigValue(db, "deepseek.baseUrl", config.baseUrl.trim());
  }
  if (config.temperature !== undefined && Number.isFinite(config.temperature)) {
    setConfigValue(db, "runtime.temperature", String(Math.min(1, Math.max(0, config.temperature))));
  }
  if (config.maxSteps !== undefined && Number.isFinite(config.maxSteps)) {
    setConfigValue(db, "runtime.maxSteps", String(Math.min(12, Math.max(3, Math.round(config.maxSteps)))));
  }
  if (config.taskBudgetUsd !== undefined && Number.isFinite(config.taskBudgetUsd)) {
    setConfigValue(db, "runtime.taskBudgetUsd", String(Math.max(0, config.taskBudgetUsd)));
  }
  if (config.planningModel !== undefined) {
    setConfigValue(db, "modelRouter.planningModel", config.planningModel.trim());
  }
  if (config.executionModel !== undefined) {
    setConfigValue(db, "modelRouter.executionModel", config.executionModel.trim());
  }
  if (config.finalModel !== undefined) {
    setConfigValue(db, "modelRouter.finalModel", config.finalModel.trim());
  }
  if (config.promptCacheEnabled !== undefined) {
    setConfigValue(db, "runtime.promptCacheEnabled", String(config.promptCacheEnabled));
  }
  return getAppConfig();
}
