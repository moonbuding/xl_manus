import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const dataFile = join(root, ".manusxl-data", "tasks.json");
const dbFile = join(root, ".manusxl-data", "manusxl.sqlite");

mkdirSync(dirname(dbFile), { recursive: true });

const db = new DatabaseSync(dbFile);
db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error TEXT,
    final_answer TEXT,
    data_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_steps (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    type TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    data_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_files (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    path TEXT,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    data_json TEXT NOT NULL
  );
`);

if (!existsSync(dataFile)) {
  console.log("No tasks.json found; SQLite schema is ready.");
  process.exit(0);
}

const tasks = JSON.parse(readFileSync(dataFile, "utf8"));
const upsertTask = db.prepare(`
  INSERT INTO tasks (id, prompt, status, model, created_at, updated_at, error, final_answer, data_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    prompt = excluded.prompt,
    status = excluded.status,
    model = excluded.model,
    updated_at = excluded.updated_at,
    error = excluded.error,
    final_answer = excluded.final_answer,
    data_json = excluded.data_json
`);
const upsertStep = db.prepare(`
  INSERT OR REPLACE INTO task_steps
    (id, task_id, type, step_index, title, content, payload_json, created_at, data_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const upsertFile = db.prepare(`
  INSERT OR REPLACE INTO task_files
    (id, task_id, filename, file_type, mime_type, path, size, created_at, data_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.exec("BEGIN");
try {
  for (const task of tasks) {
    upsertTask.run(
      task.id,
      task.prompt,
      task.status,
      task.model,
      task.createdAt,
      task.updatedAt,
      task.error ?? null,
      task.finalAnswer ?? null,
      JSON.stringify(task)
    );

    for (const event of task.events ?? []) {
      upsertStep.run(
        event.id,
        event.taskId,
        event.type,
        event.stepIndex,
        event.title ?? null,
        event.content ?? null,
        event.payload === undefined ? null : JSON.stringify(event.payload),
        event.createdAt,
        JSON.stringify(event)
      );
    }

    for (const artifact of task.artifacts ?? []) {
      upsertFile.run(
        artifact.id,
        artifact.taskId,
        artifact.name,
        artifact.type,
        artifact.mimeType,
        artifact.filePath ?? null,
        artifact.size,
        artifact.createdAt,
        JSON.stringify(artifact)
      );
    }
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const counts = {
  tasks: db.prepare("SELECT count(*) AS n FROM tasks").get().n,
  task_steps: db.prepare("SELECT count(*) AS n FROM task_steps").get().n,
  task_files: db.prepare("SELECT count(*) AS n FROM task_files").get().n
};

console.log(JSON.stringify(counts, null, 2));
