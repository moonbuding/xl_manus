import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dryRunMigration, generateMigrationSql, migrationTables } from "./migrate-sqlite-to-postgres.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = join(projectRoot, "db", "postgres", "0001_initial.sql");

function seedFixtureDatabase(sqlitePath) {
  const db = new DatabaseSync(sqlitePath);
  const now = "2026-05-22T00:00:00.000Z";
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      phone TEXT UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL,
      verification_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT,
      final_answer TEXT,
      data_json TEXT NOT NULL
    );

    CREATE TABLE task_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      owner_id TEXT,
      type TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      title TEXT,
      content TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.prepare(`
    INSERT INTO users
      (id, email, phone, display_name, password_hash, email_verified, verification_code, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "usr_fixture",
    "fixture@example.com",
    "18800000001",
    "Fixture",
    "salt.hash",
    1,
    null,
    now,
    now,
    JSON.stringify({ id: "usr_fixture", displayName: "Fixture" })
  );

  db.prepare(`
    INSERT INTO tasks
      (id, owner_id, prompt, status, model, created_at, updated_at, error, final_answer, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "task_fixture",
    "usr_fixture",
    "调研中国新能源车前五",
    "completed",
    "deepseek-v4-flash",
    now,
    now,
    null,
    "完成",
    JSON.stringify({ id: "task_fixture", status: "completed" })
  );

  db.prepare(`
    INSERT INTO task_steps
      (id, task_id, owner_id, type, step_index, title, content, payload_json, created_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "evt_fixture",
    "task_fixture",
    "usr_fixture",
    "thinking",
    1,
    "澄清目标",
    "生成计划",
    JSON.stringify({ toolName: "task_planner" }),
    now,
    JSON.stringify({ id: "evt_fixture", type: "thinking" })
  );

  db.prepare("INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)").run(
    "deepseek.model",
    "deepseek-v4-flash",
    now
  );
  db.close();
}

const tempDir = mkdtempSync(join(tmpdir(), "manusxl-pg-e2e-"));
const sqlitePath = join(tempDir, "fixture.sqlite");
const sqlPath = join(tempDir, "migration.sql");

try {
  seedFixtureDatabase(sqlitePath);

  const summary = dryRunMigration({ sqlitePath });
  assert.equal(summary.sqliteExists, true);
  assert.equal(summary.totalRows, 4);
  assert.equal(summary.tables.find((table) => table.table === "users")?.rows, 1);
  assert.equal(summary.tables.find((table) => table.table === "tasks")?.rows, 1);
  assert.equal(summary.tables.find((table) => table.table === "task_steps")?.rows, 1);
  assert.equal(summary.tables.find((table) => table.table === "app_config")?.rows, 1);
  assert.equal(summary.tables.length, migrationTables.length);

  const generated = generateMigrationSql({ sqlitePath });
  writeFileSync(sqlPath, generated.sql);

  const schema = readFileSync(schemaPath, "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS auth_sessions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS tasks/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS task_steps/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_task_steps_task_id/);
  assert.match(schema, /JSONB NOT NULL/);

  const sql = readFileSync(sqlPath, "utf8");
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /INSERT INTO "users"/);
  assert.match(sql, /INSERT INTO "tasks"/);
  assert.match(sql, /ON CONFLICT \("id"\) DO UPDATE SET/);
  assert.match(sql, /::jsonb/);
  assert.match(sql, /调研中国新能源车前五/);

  console.log(JSON.stringify({
    ok: true,
    fixtureRows: summary.totalRows,
    tableCount: summary.tables.length,
    sqlPath,
    hasSchema: existsSync(schemaPath)
  }, null, 2));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
