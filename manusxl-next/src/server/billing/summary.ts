import { listContextMetricsInRange } from "@/server/metrics/context-metrics";
import { listTasks } from "@/server/tasks/task-store";
import type {
  BillingGroupSummary,
  BillingSummary,
  BillingTaskSummary,
  ContextMetric,
  Task
} from "@/types/agent";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function parseMonth(value?: string | null) {
  return /^\d{4}-\d{2}$/.test(value ?? "") ? value! : currentMonth();
}

function monthRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthIndex - 1, 1));
  const end = new Date(Date.UTC(year, monthIndex, 1));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

function emptyGroup(name: string): BillingGroupSummary {
  return {
    name,
    totalCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    estimatedCostCny: 0
  };
}

function addMetric(target: BillingGroupSummary, metric: ContextMetric) {
  target.totalCalls += 1;
  target.promptTokens += metric.promptTokens;
  target.completionTokens += metric.completionTokens;
  target.totalTokens += metric.totalTokens;
  target.estimatedCostUsd += metric.estimatedCostUsd;
  target.estimatedCostCny += metric.estimatedCostCny;
}

function finalizeGroup(group: BillingGroupSummary): BillingGroupSummary {
  return {
    ...group,
    estimatedCostUsd: Number(group.estimatedCostUsd.toFixed(8)),
    estimatedCostCny: Number(group.estimatedCostCny.toFixed(6))
  };
}

function taskFallback(taskId: string, model: string): Task {
  const now = new Date().toISOString();
  return {
    id: taskId,
    prompt: "历史任务",
    model,
    status: "completed",
    createdAt: now,
    updatedAt: now,
    events: [],
    artifacts: []
  };
}

export function getBillingSummary(monthInput?: string | null, ownerId?: string): BillingSummary {
  const month = parseMonth(monthInput);
  const { startIso, endIso } = monthRange(month);
  const ownerTasks = listTasks(undefined, ownerId);
  const taskMap = new Map(ownerTasks.map((task) => [task.id, task]));
  const allowedTaskIds = new Set(ownerTasks.map((task) => task.id));
  const metrics = listContextMetricsInRange(startIso, endIso).filter((metric) =>
    ownerId ? !!metric.taskId && allowedTaskIds.has(metric.taskId) : true
  );

  const byTaskMap = new Map<string, BillingGroupSummary>();
  const byModelMap = new Map<string, BillingGroupSummary>();
  const byDayMap = new Map<string, BillingGroupSummary>();
  const total = emptyGroup("total");

  for (const metric of metrics) {
    addMetric(total, metric);
    const taskKey = metric.taskId ?? "unknown";
    const taskGroup = byTaskMap.get(taskKey) ?? emptyGroup(taskKey);
    addMetric(taskGroup, metric);
    byTaskMap.set(taskKey, taskGroup);

    const modelGroup = byModelMap.get(metric.model) ?? emptyGroup(metric.model);
    addMetric(modelGroup, metric);
    byModelMap.set(metric.model, modelGroup);

    const day = metric.createdAt.slice(0, 10);
    const dayGroup = byDayMap.get(day) ?? emptyGroup(day);
    addMetric(dayGroup, metric);
    byDayMap.set(day, dayGroup);
  }

  const byTask: BillingTaskSummary[] = Array.from(byTaskMap.values())
    .map((group) => {
      const firstMetric = metrics.find((metric) => metric.taskId === group.name);
      const task = taskMap.get(group.name) ?? taskFallback(group.name, firstMetric?.model ?? "unknown");
      const finalized = finalizeGroup(group);
      return {
        taskId: task.id,
        prompt: task.prompt,
        model: task.model,
        totalCalls: finalized.totalCalls,
        promptTokens: finalized.promptTokens,
        completionTokens: finalized.completionTokens,
        totalTokens: finalized.totalTokens,
        estimatedCostUsd: finalized.estimatedCostUsd,
        estimatedCostCny: finalized.estimatedCostCny,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      };
    })
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
    .slice(0, 12);

  const finalTotal = finalizeGroup(total);

  return {
    month,
    totalCalls: finalTotal.totalCalls,
    promptTokens: finalTotal.promptTokens,
    completionTokens: finalTotal.completionTokens,
    totalTokens: finalTotal.totalTokens,
    estimatedCostUsd: finalTotal.estimatedCostUsd,
    estimatedCostCny: finalTotal.estimatedCostCny,
    byTask,
    byModel: Array.from(byModelMap.values())
      .map(finalizeGroup)
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    byDay: Array.from(byDayMap.values())
      .map(finalizeGroup)
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}
