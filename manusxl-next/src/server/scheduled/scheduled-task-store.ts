import { DatabaseSync } from "node:sqlite";
import { createId } from "@/lib/id";
import { enqueueAgentTask } from "@/server/agent/scheduler";
import { getDeepSeekConfig } from "@/server/llm/deepseek";
import { getManusDb } from "@/server/sqlite";
import { addTaskEvent, createTask } from "@/server/tasks/task-store";
import type {
  CreateScheduledTaskRequest,
  ScheduledTask,
  ScheduledTaskKind,
  ScheduledTaskRunLog,
  ScheduledTaskStatus,
  ScheduledTaskTriggerType
} from "@/types/agent";

interface ScheduledStoreState {
  db: DatabaseSync;
  runnerStarted: boolean;
  runningTick: boolean;
}

const globalForScheduled = globalThis as unknown as {
  manusxlScheduledStore?: ScheduledStoreState;
};

function openScheduledDb() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      kind TEXT NOT NULL,
      interval_minutes REAL,
      cron_expression TEXT,
      timezone TEXT NOT NULL,
      next_run_at TEXT,
      last_run_at TEXT,
      last_task_id TEXT,
      run_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_owner_id ON scheduled_tasks(owner_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run_at ON scheduled_tasks(next_run_at);

    CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scheduled_task_id TEXT,
      task_id TEXT,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_owner_id ON scheduled_task_runs(owner_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_scheduled_task_id ON scheduled_task_runs(scheduled_task_id);
  `);
  return db;
}

function getState() {
  globalForScheduled.manusxlScheduledStore ??= {
    db: openScheduledDb(),
    runnerStarted: false,
    runningTick: false
  };
  return globalForScheduled.manusxlScheduledStore;
}

function rowToTask(row: { data_json: string }) {
  return JSON.parse(row.data_json) as ScheduledTask;
}

function rowToRunLog(row: { data_json: string }) {
  return JSON.parse(row.data_json) as ScheduledTaskRunLog;
}

function normalizeStatus(value: unknown): ScheduledTaskStatus {
  return value === "paused" ? "paused" : "active";
}

function normalizeKind(value: unknown): ScheduledTaskKind {
  return value === "cron" ? "cron" : "interval";
}

function normalizeIntervalMinutes(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 60;
  return Math.min(60 * 24 * 30, Math.max(0.02, number));
}

function parseCronPart(part: string, min: number, max: number) {
  const values = new Set<number>();
  const addValue = (value: number) => {
    if (Number.isInteger(value) && value >= min && value <= max) values.add(value);
  };

  part.split(",").forEach((raw) => {
    const item = raw.trim();
    if (!item || item === "*") {
      for (let value = min; value <= max; value += 1) addValue(value);
      return;
    }
    const stepMatch = item.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = Math.max(1, Number(stepMatch[1]));
      for (let value = min; value <= max; value += step) addValue(value);
      return;
    }
    const rangeMatch = item.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const step = Math.max(1, Number(rangeMatch[3] ?? 1));
      for (let value = start; value <= end; value += step) addValue(value);
      return;
    }
    addValue(Number(item));
  });

  return values;
}

function cronMatches(expression: string, date: Date) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return false;

  const minutes = parseCronPart(minute, 0, 59);
  const hours = parseCronPart(hour, 0, 23);
  const days = parseCronPart(dayOfMonth, 1, 31);
  const months = parseCronPart(month, 1, 12);
  const weekdays = parseCronPart(dayOfWeek, 0, 7);
  const normalizedWeekday = date.getDay();

  return (
    minutes.has(date.getMinutes()) &&
    hours.has(date.getHours()) &&
    days.has(date.getDate()) &&
    months.has(date.getMonth() + 1) &&
    (weekdays.has(normalizedWeekday) || (normalizedWeekday === 0 && weekdays.has(7)))
  );
}

function computeNextCronRun(expression: string, after = new Date()) {
  const start = new Date(after.getTime() + 60_000);
  start.setSeconds(0, 0);
  const maxChecks = 60 * 24 * 366;
  for (let index = 0; index < maxChecks; index += 1) {
    const candidate = new Date(start.getTime() + index * 60_000);
    if (cronMatches(expression, candidate)) return candidate.toISOString();
  }
  throw new Error("Cron 表达式在未来一年内没有可匹配时间");
}

function computeNextRun(task: Pick<ScheduledTask, "kind" | "intervalMinutes" | "cronExpression">, after = new Date()) {
  if (task.kind === "cron") {
    const expression = task.cronExpression?.trim();
    if (!expression) throw new Error("Cron expression is required");
    return computeNextCronRun(expression, after);
  }
  const intervalMinutes = normalizeIntervalMinutes(task.intervalMinutes);
  return new Date(after.getTime() + intervalMinutes * 60_000).toISOString();
}

function upsertTaskRecord(task: ScheduledTask) {
  const db = getState().db;
  db.prepare(`
    INSERT INTO scheduled_tasks (
      id, owner_id, name, prompt, model, status, kind, interval_minutes,
      cron_expression, timezone, next_run_at, last_run_at, last_task_id,
      run_count, created_at, updated_at, data_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      prompt = excluded.prompt,
      model = excluded.model,
      status = excluded.status,
      kind = excluded.kind,
      interval_minutes = excluded.interval_minutes,
      cron_expression = excluded.cron_expression,
      timezone = excluded.timezone,
      next_run_at = excluded.next_run_at,
      last_run_at = excluded.last_run_at,
      last_task_id = excluded.last_task_id,
      run_count = excluded.run_count,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(
    task.id,
    task.ownerId,
    task.name,
    task.prompt,
    task.model,
    task.status,
    task.kind,
    task.intervalMinutes ?? null,
    task.cronExpression ?? null,
    task.timezone,
    task.nextRunAt ?? null,
    task.lastRunAt ?? null,
    task.lastTaskId ?? null,
    task.runCount,
    task.createdAt,
    task.updatedAt,
    JSON.stringify(task)
  );
}

function insertRunLog(log: ScheduledTaskRunLog) {
  getState().db.prepare(`
    INSERT INTO scheduled_task_runs (
      id, owner_id, scheduled_task_id, task_id, trigger_type,
      status, source, message, created_at, data_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.id,
    log.ownerId,
    log.scheduledTaskId ?? null,
    log.taskId ?? null,
    log.triggerType,
    log.status,
    log.source,
    log.message,
    log.createdAt,
    JSON.stringify(log)
  );
  return log;
}

function createTriggeredTask(input: {
  ownerId: string;
  prompt: string;
  model?: string;
  triggerType: ScheduledTaskTriggerType;
  source: string;
  scheduledTaskId?: string;
}) {
  const task = createTask(input.prompt, input.model?.trim() || getDeepSeekConfig().model, input.ownerId);
  addTaskEvent(task.id, {
    type: "message",
    stepIndex: 1,
    title: "被动触发",
    content: `${input.source} 已创建任务，触发类型：${input.triggerType}。`,
    payload: {
      triggerType: input.triggerType,
      scheduledTaskId: input.scheduledTaskId,
      source: input.source
    }
  });
  const queue = enqueueAgentTask(task.id);
  return { task, queue };
}

export function createScheduledTask(ownerId: string, input: CreateScheduledTaskRequest) {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Prompt is required");

  const now = new Date().toISOString();
  const kind = normalizeKind(input.kind);
  const intervalMinutes = kind === "interval" ? normalizeIntervalMinutes(input.intervalMinutes) : undefined;
  const cronExpression = kind === "cron" ? input.cronExpression?.trim() : undefined;
  const task: ScheduledTask = {
    id: createId("sched"),
    ownerId,
    name: input.name?.trim() || prompt.slice(0, 48),
    prompt,
    model: input.model?.trim() || getDeepSeekConfig().model,
    status: normalizeStatus(input.status),
    kind,
    intervalMinutes,
    cronExpression,
    timezone: input.timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    runCount: 0,
    createdAt: now,
    updatedAt: now
  };
  task.nextRunAt = task.status === "active" ? computeNextRun(task, new Date()) : undefined;
  upsertTaskRecord(task);
  startScheduledTaskRunner();
  return task;
}

export function listScheduledTasks(ownerId: string) {
  const rows = getState().db
    .prepare("SELECT data_json FROM scheduled_tasks WHERE owner_id = ? ORDER BY datetime(created_at) DESC")
    .all(ownerId) as Array<{ data_json: string }>;
  return rows.map(rowToTask);
}

export function getScheduledTask(scheduleId: string, ownerId?: string) {
  const row = ownerId
    ? (getState().db
        .prepare("SELECT data_json FROM scheduled_tasks WHERE id = ? AND owner_id = ?")
        .get(scheduleId, ownerId) as { data_json: string } | undefined)
    : (getState().db
        .prepare("SELECT data_json FROM scheduled_tasks WHERE id = ?")
        .get(scheduleId) as { data_json: string } | undefined);
  return row ? rowToTask(row) : undefined;
}

export function updateScheduledTask(scheduleId: string, ownerId: string, input: Partial<CreateScheduledTaskRequest>) {
  const existing = getScheduledTask(scheduleId, ownerId);
  if (!existing) return undefined;

  const next: ScheduledTask = {
    ...existing,
    name: input.name !== undefined ? input.name.trim() || existing.name : existing.name,
    prompt: input.prompt !== undefined ? input.prompt.trim() : existing.prompt,
    model: input.model !== undefined ? input.model.trim() || existing.model : existing.model,
    status: input.status !== undefined ? normalizeStatus(input.status) : existing.status,
    kind: input.kind !== undefined ? normalizeKind(input.kind) : existing.kind,
    timezone: input.timezone !== undefined ? input.timezone.trim() || existing.timezone : existing.timezone,
    updatedAt: new Date().toISOString()
  };

  next.intervalMinutes =
    next.kind === "interval"
      ? normalizeIntervalMinutes(input.intervalMinutes ?? existing.intervalMinutes)
      : undefined;
  next.cronExpression =
    next.kind === "cron"
      ? input.cronExpression?.trim() ?? existing.cronExpression
      : undefined;
  next.nextRunAt = next.status === "active" ? computeNextRun(next, new Date()) : undefined;
  upsertTaskRecord(next);
  startScheduledTaskRunner();
  return next;
}

export function deleteScheduledTask(scheduleId: string, ownerId: string) {
  const task = getScheduledTask(scheduleId, ownerId);
  if (!task) return false;
  getState().db.prepare("DELETE FROM scheduled_tasks WHERE id = ? AND owner_id = ?").run(scheduleId, ownerId);
  return true;
}

export function listScheduledTaskRunLogs(ownerId: string, limit = 20) {
  const rows = getState().db
    .prepare("SELECT data_json FROM scheduled_task_runs WHERE owner_id = ? ORDER BY datetime(created_at) DESC LIMIT ?")
    .all(ownerId, Math.max(1, Math.min(100, Math.floor(limit)))) as Array<{ data_json: string }>;
  return rows.map(rowToRunLog);
}

export function runScheduledTask(scheduleId: string, ownerId: string, triggerType: ScheduledTaskTriggerType = "manual") {
  const schedule = getScheduledTask(scheduleId, ownerId);
  if (!schedule) throw new Error("Scheduled task not found");
  if (schedule.status !== "active" && triggerType === "schedule") {
    return insertRunLog({
      id: createId("srun"),
      ownerId,
      scheduledTaskId: schedule.id,
      triggerType,
      status: "skipped",
      source: schedule.name,
      message: "计划任务已暂停，跳过本次触发。",
      createdAt: new Date().toISOString()
    });
  }

  const { task } = createTriggeredTask({
    ownerId,
    prompt: schedule.prompt,
    model: schedule.model,
    triggerType,
    source: `scheduled:${schedule.name}`,
    scheduledTaskId: schedule.id
  });
  const now = new Date();
  const nextSchedule: ScheduledTask = {
    ...schedule,
    lastRunAt: now.toISOString(),
    lastTaskId: task.id,
    runCount: schedule.runCount + 1,
    nextRunAt: schedule.status === "active" ? computeNextRun(schedule, now) : undefined,
    updatedAt: now.toISOString()
  };
  upsertTaskRecord(nextSchedule);
  return insertRunLog({
    id: createId("srun"),
    ownerId,
    scheduledTaskId: schedule.id,
    taskId: task.id,
    triggerType,
    status: "created",
    source: schedule.name,
    message: `已创建任务 ${task.id}`,
    createdAt: now.toISOString()
  });
}

export function runDueScheduledTasks(ownerId?: string) {
  const now = new Date().toISOString();
  const rows = ownerId
    ? (getState().db
        .prepare(
          "SELECT data_json FROM scheduled_tasks WHERE owner_id = ? AND status = 'active' AND next_run_at IS NOT NULL AND datetime(next_run_at) <= datetime(?)"
        )
        .all(ownerId, now) as Array<{ data_json: string }>)
    : (getState().db
        .prepare(
          "SELECT data_json FROM scheduled_tasks WHERE status = 'active' AND next_run_at IS NOT NULL AND datetime(next_run_at) <= datetime(?)"
        )
        .all(now) as Array<{ data_json: string }>);
  const logs: ScheduledTaskRunLog[] = [];
  rows.map(rowToTask).forEach((task) => {
    try {
      logs.push(runScheduledTask(task.id, task.ownerId, "schedule"));
    } catch (error) {
      logs.push(
        insertRunLog({
          id: createId("srun"),
          ownerId: task.ownerId,
          scheduledTaskId: task.id,
          triggerType: "schedule",
          status: "failed",
          source: task.name,
          message: error instanceof Error ? error.message : "计划任务触发失败",
          createdAt: new Date().toISOString()
        })
      );
    }
  });
  return logs;
}

export function triggerInboundTask(input: {
  ownerId: string;
  triggerType: Extract<ScheduledTaskTriggerType, "mail" | "slack">;
  prompt: string;
  source: string;
}) {
  const { task } = createTriggeredTask({
    ownerId: input.ownerId,
    prompt: input.prompt,
    triggerType: input.triggerType,
    source: input.source
  });
  const log = insertRunLog({
    id: createId("srun"),
    ownerId: input.ownerId,
    taskId: task.id,
    triggerType: input.triggerType,
    status: "created",
    source: input.source,
    message: `已创建任务 ${task.id}`,
    createdAt: new Date().toISOString()
  });
  return { task, log };
}

export function startScheduledTaskRunner() {
  const state = getState();
  if (state.runnerStarted) return;
  state.runnerStarted = true;

  setInterval(() => {
    if (state.runningTick) return;
    state.runningTick = true;
    try {
      runDueScheduledTasks();
    } catch (error) {
      console.warn(`计划任务调度失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      state.runningTick = false;
    }
  }, Number(process.env.MANUSXL_SCHEDULED_TICK_MS ?? 5000));
}

export function scheduledTaskMailbox(ownerId: string) {
  return `${ownerId}@mail.xl-manus.local`;
}

export function ownerIdFromMailbox(value: string) {
  const match = value.toLowerCase().match(/([a-z0-9_]+)@mail\.xl-manus\.local/);
  return match?.[1];
}
