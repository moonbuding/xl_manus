import { getTaskTimeoutMs } from "@/server/agent/runtime-config";
import { isAgentTaskRunning, runAgentTask } from "@/server/agent/runtime";
import { addTaskEvent, getEventPersistenceStats, getTask } from "@/server/tasks/task-store";

interface SchedulerState {
  queue: string[];
  running: Set<string>;
  runningByOwner: Map<string, Set<string>>;
  queuedNotice: Set<string>;
  resumed: Map<string, boolean>;
}

export interface EnqueueResult {
  taskId: string;
  status: "queued" | "running" | "skipped" | "missing";
  queuePosition?: number;
}

const globalForScheduler = globalThis as unknown as {
  manusxlScheduler?: SchedulerState;
};

function getSchedulerState() {
  globalForScheduler.manusxlScheduler ??= {
    queue: [],
    running: new Set<string>(),
    runningByOwner: new Map<string, Set<string>>(),
    queuedNotice: new Set<string>(),
    resumed: new Map<string, boolean>()
  };
  return globalForScheduler.manusxlScheduler;
}

function schedulerLimits() {
  const perUser = Number(process.env.MANUSXL_MAX_CONCURRENT_PER_USER ?? 2);
  const total = Number(process.env.MANUSXL_MAX_TOTAL_TASKS ?? 50);
  return {
    perUser: Number.isFinite(perUser) && perUser > 0 ? Math.floor(perUser) : 2,
    total: Number.isFinite(total) && total > 0 ? Math.floor(total) : 50
  };
}

function ownerKey(ownerId?: string) {
  return ownerId || "anonymous";
}

function runningForOwner(state: SchedulerState, ownerId?: string) {
  const key = ownerKey(ownerId);
  const running = state.runningByOwner.get(key) ?? new Set<string>();
  state.runningByOwner.set(key, running);
  return running;
}

function canStartTask(taskId: string) {
  const task = getTask(taskId);
  if (!task || (task.status !== "queued" && task.status !== "running")) return false;
  const state = getSchedulerState();
  const limits = schedulerLimits();
  return state.running.size < limits.total && runningForOwner(state, task.ownerId).size < limits.perUser;
}

function queuePosition(taskId: string) {
  const index = getSchedulerState().queue.indexOf(taskId);
  return index >= 0 ? index + 1 : undefined;
}

function pruneQueue() {
  const state = getSchedulerState();
  state.queue = state.queue.filter((taskId) => {
    const task = getTask(taskId);
    return !!task && (task.status === "queued" || task.status === "running");
  });
}

function startTask(taskId: string) {
  const task = getTask(taskId);
  if (!task) return;
  const state = getSchedulerState();
  const ownerRunning = runningForOwner(state, task.ownerId);
  state.running.add(taskId);
  ownerRunning.add(taskId);

  void runAgentTask(taskId, { resumed: state.resumed.get(taskId) }).finally(() => {
    state.running.delete(taskId);
    ownerRunning.delete(taskId);
    state.resumed.delete(taskId);
    pumpQueue();
  });
}

function pumpQueue() {
  const state = getSchedulerState();
  pruneQueue();

  while (state.queue.length > 0) {
    const nextIndex = state.queue.findIndex(canStartTask);
    if (nextIndex < 0) return;
    const [taskId] = state.queue.splice(nextIndex, 1);
    if (!taskId || state.running.has(taskId) || isAgentTaskRunning(taskId)) continue;
    startTask(taskId);
  }
}

export function enqueueAgentTask(taskId: string, options: { resumed?: boolean } = {}): EnqueueResult {
  const task = getTask(taskId);
  if (!task) return { taskId, status: "missing" };
  if (task.status !== "queued" && task.status !== "running") {
    return { taskId, status: "skipped" };
  }

  const state = getSchedulerState();
  state.resumed.set(taskId, Boolean(options.resumed) || Boolean(state.resumed.get(taskId)));

  if (state.running.has(taskId) || isAgentTaskRunning(taskId)) {
    return { taskId, status: "running" };
  }

  if (!state.queue.includes(taskId)) {
    state.queue.push(taskId);
  }

  if (!state.queuedNotice.has(taskId)) {
    const limits = schedulerLimits();
    addTaskEvent(taskId, {
      type: "message",
      stepIndex: task.events.length + 1,
      title: "任务排队",
      content: `任务已进入执行队列。当前限制：每用户最多 ${limits.perUser} 个并发任务，全局最多 ${limits.total} 个并发任务。`
    });
    state.queuedNotice.add(taskId);
  }

  pumpQueue();

  if (state.running.has(taskId) || isAgentTaskRunning(taskId)) {
    return { taskId, status: "running" };
  }
  return { taskId, status: "queued", queuePosition: queuePosition(taskId) };
}

export function getSchedulerSnapshot() {
  const state = getSchedulerState();
  pruneQueue();
  return {
    limits: schedulerLimits(),
    runtime: {
      taskTimeoutMs: getTaskTimeoutMs()
    },
    eventPersistence: getEventPersistenceStats(),
    queue: [...state.queue],
    running: [...state.running],
    runningByOwner: Object.fromEntries(
      [...state.runningByOwner.entries()].map(([ownerId, tasks]) => [ownerId, [...tasks]])
    )
  };
}
