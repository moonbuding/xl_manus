import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPsqlCommand, checkPsqlClient, runPsql } from "./lib/psql-runner.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = join(projectRoot, "db", "postgres", "0001_initial.sql");
const databaseUrl = process.env.MANUSXL_PG_E2E_DATABASE_URL || process.env.DATABASE_URL;
const schemaName = `manusxl_e2e_${Date.now().toString(36)}`;
const writerCount = Number(process.env.MANUSXL_PG_E2E_WRITERS || 10);
const eventsPerWriter = Number(process.env.MANUSXL_PG_E2E_EVENTS || 25);

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonValue(value) {
  return `${quoteValue(JSON.stringify(value))}::jsonb`;
}

function requireDatabaseUrl() {
  assert(
    databaseUrl,
    [
      "需要设置 MANUSXL_PG_E2E_DATABASE_URL 或 DATABASE_URL 才能执行真实 PostgreSQL 并发验收。",
      "示例：MANUSXL_PG_E2E_DATABASE_URL=postgresql://manusxl:manusxl@localhost:5432/manusxl npm run e2e:pg-concurrency"
    ].join("\n")
  );
  return databaseUrl;
}

function runSql(sql, options = {}) {
  return runPsql(requireDatabaseUrl(), ["-X", "-q", "-c", sql], {
    client: options.client,
    timeoutMs: options.timeoutMs ?? 30_000
  });
}

function runSqlAsync(sql, client) {
  const command = buildPsqlCommand(
    requireDatabaseUrl(),
    ["-X", "-q", "-c", sql],
    client
  );
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error((stderr || stdout || `psql exited ${code}`).trim()));
    });
  });
}

function bootstrapSql() {
  const schemaSql = readFileSync(schemaPath, "utf8");
  return [
    `DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE;`,
    `CREATE SCHEMA ${quoteIdentifier(schemaName)};`,
    `SET search_path TO ${quoteIdentifier(schemaName)};`,
    schemaSql
  ].join("\n");
}

function seedSql() {
  const now = new Date().toISOString();
  const user = {
    id: "usr_pg_concurrency",
    email: "pg-concurrency@example.com",
    displayName: "PG Concurrency"
  };
  const task = {
    id: "task_pg_concurrency",
    ownerId: user.id,
    prompt: "PostgreSQL 10 concurrent task_steps write acceptance",
    status: "running",
    model: "deepseek-v4-flash",
    createdAt: now,
    updatedAt: now,
    events: [],
    artifacts: []
  };
  return `
    SET search_path TO ${quoteIdentifier(schemaName)};
    INSERT INTO users
      (id, email, phone, display_name, password_hash, email_verified, verification_code, created_at, updated_at, data_json)
    VALUES (
      ${quoteValue(user.id)},
      ${quoteValue(user.email)},
      NULL,
      ${quoteValue(user.displayName)},
      'e2e.hash',
      1,
      NULL,
      ${quoteValue(now)},
      ${quoteValue(now)},
      ${jsonValue(user)}
    );
    INSERT INTO tasks
      (id, owner_id, prompt, status, model, created_at, updated_at, error, final_answer, data_json)
    VALUES (
      ${quoteValue(task.id)},
      ${quoteValue(task.ownerId)},
      ${quoteValue(task.prompt)},
      ${quoteValue(task.status)},
      ${quoteValue(task.model)},
      ${quoteValue(task.createdAt)},
      ${quoteValue(task.updatedAt)},
      NULL,
      NULL,
      ${jsonValue(task)}
    );
  `;
}

function writerSql(writerIndex) {
  const now = new Date().toISOString();
  const values = Array.from({ length: eventsPerWriter }, (_, eventIndex) => {
    const id = `evt_pg_${writerIndex}_${eventIndex}`;
    const event = {
      id,
      taskId: "task_pg_concurrency",
      type: "tool_result",
      stepIndex: eventIndex,
      title: `writer ${writerIndex}`,
      content: `event ${eventIndex}`,
      payload: { writerIndex, eventIndex },
      createdAt: now
    };
    return `(
      ${quoteValue(id)},
      'task_pg_concurrency',
      'usr_pg_concurrency',
      'tool_result',
      ${eventIndex},
      ${quoteValue(event.title)},
      ${quoteValue(event.content)},
      ${jsonValue(event.payload)},
      ${quoteValue(now)},
      ${jsonValue(event)}
    )`;
  }).join(",\n");

  return `
    SET search_path TO ${quoteIdentifier(schemaName)};
    INSERT INTO task_steps
      (id, task_id, owner_id, type, step_index, title, content, payload_json, created_at, data_json)
    VALUES ${values}
    ON CONFLICT (id) DO UPDATE SET
      content = EXCLUDED.content,
      payload_json = EXCLUDED.payload_json,
      data_json = EXCLUDED.data_json;
  `;
}

async function main() {
  const client = checkPsqlClient();
  assert(client.available, client.error ?? "未找到可用的 psql 客户端");
  requireDatabaseUrl();

  const startedAt = Date.now();
  runSql(bootstrapSql(), { client, timeoutMs: 60_000 });
  runSql(seedSql(), { client });

  await Promise.all(
    Array.from({ length: writerCount }, (_, index) => runSqlAsync(writerSql(index), client))
  );

  const countOutput = runSql(
    `
      SET search_path TO ${quoteIdentifier(schemaName)};
      SELECT count(*) FROM task_steps WHERE task_id = 'task_pg_concurrency';
    `,
    { client }
  );
  const count = Number(countOutput.split("\n").find((line) => /^\d+$/.test(line.trim()))?.trim());
  assert.equal(count, writerCount * eventsPerWriter);

  runSql(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE;`, { client });

  console.log(JSON.stringify({
    ok: true,
    psqlSource: client.source,
    psqlVersion: client.version,
    schema: schemaName,
    writers: writerCount,
    eventsPerWriter,
    insertedTaskSteps: count,
    elapsedMs: Date.now() - startedAt
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
