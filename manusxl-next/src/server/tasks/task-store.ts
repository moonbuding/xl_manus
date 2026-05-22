import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { byteSize, createId } from "@/lib/id";
import { dataPath } from "@/server/data-root";
import { getManusDb } from "@/server/sqlite";
import type { AgentEvent, Artifact, Task, TaskStatus } from "@/types/agent";

type Subscriber = (event: AgentEvent) => void;

interface TaskStoreState {
  tasks: Map<string, Task>;
  subscribers: Map<string, Set<Subscriber>>;
  db: DatabaseSync;
  pendingEvents: Array<{ event: AgentEvent; ownerId?: string }>;
  pendingTaskIds: Set<string>;
  flushTimer?: ReturnType<typeof setTimeout>;
}

const globalForTasks = globalThis as unknown as {
  manusxlTaskStore?: TaskStoreState;
};

const dataFile = dataPath("tasks.json");
const workspaceRoot = dataPath("workspaces");

function taskArtifactDir(taskId: string, ownerId?: string) {
  return ownerId ? join(workspaceRoot, ownerId, taskId, "artifacts") : join(workspaceRoot, taskId, "artifacts");
}

function sanitizeFilename(value: string) {
  return value.replace(/[/:*?"<>|\\]/g, "_").replace(/\s+/g, "-");
}

function readPersistedTasks() {
  try {
    if (!existsSync(dataFile)) return new Map<string, Task>();
    const raw = readFileSync(dataFile, "utf8");
    const parsed = JSON.parse(raw) as Task[];
    return new Map(parsed.map((task) => [task.id, task]));
  } catch {
    return new Map<string, Task>();
  }
}

function openDatabase() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
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

    CREATE TABLE IF NOT EXISTS task_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      owner_id TEXT,
      type TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      title TEXT,
      content TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_steps_task_id ON task_steps(task_id);

    CREATE TABLE IF NOT EXISTS task_files (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      owner_id TEXT,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      path TEXT,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_files_task_id ON task_files(task_id);
  `);
  ensureTaskSchema(db);
  return db;
}

function ensureTaskSchema(db: DatabaseSync) {
  const columnSet = (table: string) =>
    new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );

  if (!columnSet("tasks").has("owner_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN owner_id TEXT");
  }
  if (!columnSet("task_steps").has("owner_id")) {
    db.exec("ALTER TABLE task_steps ADD COLUMN owner_id TEXT");
  }
  if (!columnSet("task_files").has("owner_id")) {
    db.exec("ALTER TABLE task_files ADD COLUMN owner_id TEXT");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_owner_id ON tasks(owner_id);
    CREATE INDEX IF NOT EXISTS idx_task_steps_owner_id ON task_steps(owner_id);
    CREATE INDEX IF NOT EXISTS idx_task_files_owner_id ON task_files(owner_id);
  `);
}

function upsertTask(db: DatabaseSync, task: Task) {
  db.prepare(`
    INSERT INTO tasks (id, owner_id, prompt, status, model, created_at, updated_at, error, final_answer, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      owner_id = excluded.owner_id,
      prompt = excluded.prompt,
      status = excluded.status,
      model = excluded.model,
      updated_at = excluded.updated_at,
      error = excluded.error,
      final_answer = excluded.final_answer,
      data_json = excluded.data_json
  `).run(
    task.id,
    task.ownerId ?? null,
    task.prompt,
    task.status,
    task.model,
    task.createdAt,
    task.updatedAt,
    task.error ?? null,
    task.finalAnswer ?? null,
    JSON.stringify(task)
  );
}

function insertStep(db: DatabaseSync, event: AgentEvent, ownerId?: string) {
  db.prepare(`
    INSERT OR REPLACE INTO task_steps
      (id, task_id, owner_id, type, step_index, title, content, payload_json, created_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.taskId,
    ownerId ?? null,
    event.type,
    event.stepIndex,
    event.title ?? null,
    event.content ?? null,
    event.payload === undefined ? null : JSON.stringify(event.payload),
    event.createdAt,
    JSON.stringify(event)
  );
}

function configuredPositiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function eventBatchSize() {
  return configuredPositiveNumber("MANUSXL_EVENT_BATCH_SIZE", 5);
}

function eventFlushDelayMs() {
  return configuredPositiveNumber("MANUSXL_EVENT_FLUSH_MS", 1000);
}

function isTerminalEvent(event: AgentEvent) {
  return event.type === "finished" || event.type === "failed" || event.type === "artifact";
}

function insertFile(db: DatabaseSync, artifact: Artifact, ownerId?: string) {
  db.prepare(`
    INSERT OR REPLACE INTO task_files
      (id, task_id, owner_id, filename, file_type, mime_type, path, size, created_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    artifact.id,
    artifact.taskId,
    ownerId ?? null,
    artifact.name,
    artifact.type,
    artifact.mimeType,
    artifact.filePath ?? null,
    artifact.size,
    artifact.createdAt,
    JSON.stringify(artifact)
  );
}

function migrateJsonTasks(db: DatabaseSync) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
  if (existing.count > 0) return;

  const jsonTasks = readPersistedTasks();
  if (jsonTasks.size === 0) return;

  db.exec("BEGIN");
  try {
    jsonTasks.forEach((task) => {
      upsertTask(db, task);
      task.events.forEach((event) => insertStep(db, event, task.ownerId));
      task.artifacts.forEach((artifact) => insertFile(db, artifact, task.ownerId));
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readSqliteTasks(db: DatabaseSync) {
  migrateJsonTasks(db);
  const rows = db
    .prepare("SELECT data_json FROM tasks ORDER BY datetime(created_at) DESC")
    .all() as Array<{ data_json: string }>;

  return new Map(
    rows.map((row) => {
      const task = JSON.parse(row.data_json) as Task;
      return [task.id, task] as const;
    })
  );
}

function persistTask(task: Task) {
  upsertTask(getState().db, task);
}

function flushPendingEventWrites(state = getState()) {
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = undefined;
  }
  if (state.pendingEvents.length === 0 && state.pendingTaskIds.size === 0) return;

  const pendingEvents = state.pendingEvents.splice(0);
  const pendingTaskIds = [...state.pendingTaskIds];
  state.pendingTaskIds.clear();

  state.db.exec("BEGIN");
  try {
    pendingEvents.forEach(({ event, ownerId }) => insertStep(state.db, event, ownerId));
    pendingTaskIds.forEach((taskId) => {
      const task = state.tasks.get(taskId);
      if (task) upsertTask(state.db, task);
    });
    state.db.exec("COMMIT");
  } catch (error) {
    state.db.exec("ROLLBACK");
    state.pendingEvents.unshift(...pendingEvents);
    pendingTaskIds.forEach((taskId) => state.pendingTaskIds.add(taskId));
    throw error;
  }
}

function schedulePendingEventFlush(state: TaskStoreState) {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(() => {
    try {
      flushPendingEventWrites(state);
    } catch {
      state.flushTimer = undefined;
    }
  }, eventFlushDelayMs());
}

function queueEventPersist(state: TaskStoreState, task: Task, event: AgentEvent) {
  state.pendingEvents.push({ event, ownerId: task.ownerId });
  state.pendingTaskIds.add(task.id);

  if (isTerminalEvent(event) || state.pendingEvents.length >= eventBatchSize()) {
    flushPendingEventWrites(state);
    return;
  }

  schedulePendingEventFlush(state);
}

function persistArtifactManifest(task: Task) {
  const dir = taskArtifactDir(task.id, task.ownerId);
  mkdirSync(dir, { recursive: true });
  const manifest = [
    `# Artifact Manifest`,
    ``,
    `Task ID: ${task.id}`,
    `Prompt: ${task.prompt}`,
    `Updated: ${task.updatedAt}`,
    ``,
    `| Name | Type | Size | Path |`,
    `|------|------|------|------|`,
    ...task.artifacts.map(
      (artifact) =>
        `| ${artifact.name} | ${artifact.type} | ${artifact.size} | ${artifact.filePath ?? "legacy-inline"} |`
    )
  ].join("\n");
  writeFileSync(join(dir, "manifest.md"), manifest);
}

function getState() {
  const existingState = globalForTasks.manusxlTaskStore;
  if (existingState?.db) {
    ensureTaskSchema(existingState.db);
    existingState.pendingEvents ??= [];
    existingState.pendingTaskIds ??= new Set<string>();
    return existingState;
  }

  const db = openDatabase();
  const nextState: TaskStoreState = {
    tasks: readSqliteTasks(db),
    subscribers: existingState?.subscribers ?? new Map<string, Set<Subscriber>>(),
    db,
    pendingEvents: [],
    pendingTaskIds: new Set<string>()
  };
  globalForTasks.manusxlTaskStore = nextState;
  return nextState;
}

export function listTasks(query?: string, ownerId?: string) {
  const state = getState();
  const normalizedQuery = query?.trim().toLowerCase();
  return Array.from(state.tasks.values())
    .filter((task) => (ownerId ? task.ownerId === ownerId : true))
    .filter((task) =>
      normalizedQuery
        ? task.prompt.toLowerCase().includes(normalizedQuery) ||
          task.id.toLowerCase().includes(normalizedQuery)
        : true
    )
    .sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}

export function listRecoverableTasks(ownerId?: string) {
  return listTasks(undefined, ownerId).filter(
    (task) => task.status === "queued" || task.status === "running"
  );
}

export function getTask(taskId: string, ownerId?: string) {
  const state = getState();
  const task = state.tasks.get(taskId);
  if (!task) return undefined;
  if (ownerId && task.ownerId !== ownerId) return undefined;
  return task;
}

export function createTask(
  prompt: string,
  model: string,
  ownerId?: string,
  uploadedFileIds: string[] = []
) {
  const state = getState();
  const now = new Date().toISOString();
  const task: Task = {
    id: createId("task"),
    ownerId,
    prompt,
    uploadedFileIds: uploadedFileIds.length > 0 ? uploadedFileIds : undefined,
    model,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    events: [],
    artifacts: []
  };

  state.tasks.set(task.id, task);
  persistTask(task);
  return task;
}

export function updateTaskStatus(taskId: string, status: TaskStatus, error?: string) {
  const task = getTask(taskId);
  if (!task) return;
  task.status = status;
  task.error = error;
  task.updatedAt = new Date().toISOString();
  persistTask(task);
}

export function setFinalAnswer(taskId: string, finalAnswer: string) {
  const task = getTask(taskId);
  if (!task) return;
  task.finalAnswer = finalAnswer;
  task.updatedAt = new Date().toISOString();
  persistTask(task);
}

export function isTaskCancelled(taskId: string) {
  return getTask(taskId)?.status === "cancelled";
}

export function addTaskEvent(
  taskId: string,
  event: Omit<AgentEvent, "id" | "taskId" | "createdAt">
) {
  const task = getTask(taskId);
  if (!task) return;

  const fullEvent: AgentEvent = {
    id: createId("evt"),
    taskId,
    createdAt: new Date().toISOString(),
    ...event
  };

  task.events.push(fullEvent);
  task.updatedAt = fullEvent.createdAt;
  const state = getState();
  queueEventPersist(state, task, fullEvent);

  const subscribers = state.subscribers.get(taskId);
  subscribers?.forEach((subscriber) => subscriber(fullEvent));
}

export function addArtifact(
  taskId: string,
  artifact: Pick<Artifact, "name" | "type" | "mimeType" | "content"> &
    Partial<Pick<Artifact, "contentEncoding">>
) {
  const task = getTask(taskId);
  if (!task || artifact.content === undefined) return;

  const artifactId = createId("art");
  const contentEncoding = artifact.contentEncoding ?? "text";
  const buffer =
    contentEncoding === "base64"
      ? Buffer.from(artifact.content, "base64")
      : Buffer.from(artifact.content);
  const dir = taskArtifactDir(taskId, task.ownerId);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${artifactId}-${sanitizeFilename(artifact.name)}`);
  writeFileSync(filePath, buffer);

  const fullArtifact: Artifact = {
    id: artifactId,
    taskId,
    name: artifact.name,
    type: artifact.type,
    mimeType: artifact.mimeType,
    contentEncoding,
    filePath,
    size: buffer.length || byteSize(artifact.content),
    createdAt: new Date().toISOString(),
    url: `/api/tasks/${taskId}/artifacts/`
  };

  fullArtifact.url = `/api/tasks/${taskId}/artifacts/${fullArtifact.id}`;
  task.artifacts.push(fullArtifact);
  task.updatedAt = fullArtifact.createdAt;
  persistArtifactManifest(task);
  insertFile(getState().db, fullArtifact, task.ownerId);
  persistTask(task);
  return fullArtifact;
}

export function subscribeToTask(taskId: string, subscriber: Subscriber) {
  const state = getState();
  const existing = state.subscribers.get(taskId) ?? new Set<Subscriber>();
  existing.add(subscriber);
  state.subscribers.set(taskId, existing);

  return () => {
    existing.delete(subscriber);
    if (existing.size === 0) {
      state.subscribers.delete(taskId);
    }
  };
}

export function cancelTask(taskId: string, ownerId?: string) {
  const task = getTask(taskId, ownerId);
  if (!task || ["completed", "failed", "cancelled", "timeout"].includes(task.status)) {
    return task;
  }

  updateTaskStatus(taskId, "cancelled");
  addTaskEvent(taskId, {
    type: "failed",
    stepIndex: task.events.length + 1,
    title: "任务已取消",
    content: "用户取消了当前任务。"
  });
  return getTask(taskId);
}
