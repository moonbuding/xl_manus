import { listAuditLogs, verifyAuditChain } from "@/server/audit/audit-store";
import {
  getContextMetricsSummary,
  listContextMetricsInRange
} from "@/server/metrics/context-metrics";
import { getSandboxStatus } from "@/server/sandbox/docker-sandbox";
import { listTasks } from "@/server/tasks/task-store";
import type { AuditLogStatus, Task, TaskStatus } from "@/types/agent";

const taskStatuses: TaskStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timeout"
];
const auditStatuses: AuditLogStatus[] = ["started", "completed", "failed", "blocked"];
const terminalTaskStatuses = new Set<TaskStatus>(["completed", "failed", "cancelled", "timeout"]);
const sandboxStatusTtlMs = 15_000;

const globalForPrometheus = globalThis as unknown as {
  manusxlPrometheusSandboxStatus?: {
    expiresAt: number;
    value: Awaited<ReturnType<typeof getSandboxStatus>>;
  };
};

type MetricType = "counter" | "gauge";

interface MetricSample {
  name: string;
  help: string;
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
}

function escapeLabelValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function labelText(labels?: Record<string, string>) {
  if (!labels || Object.keys(labels).length === 0) return "";
  const serialized = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(",");
  return `{${serialized}}`;
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function taskDurationSeconds(task: Task) {
  const startedAt = Date.parse(task.createdAt);
  const finishedAt = Date.parse(task.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return 0;
  return Math.max(0, (finishedAt - startedAt) / 1000);
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index];
}

function oneHourAgoIso(now = Date.now()) {
  return new Date(now - 60 * 60 * 1000).toISOString();
}

async function getCachedSandboxStatus() {
  const now = Date.now();
  const cached = globalForPrometheus.manusxlPrometheusSandboxStatus;
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await getSandboxStatus();
  globalForPrometheus.manusxlPrometheusSandboxStatus = {
    expiresAt: now + sandboxStatusTtlMs,
    value
  };
  return value;
}

function renderMetricSamples(samples: MetricSample[]) {
  const lines: string[] = [
    "# ManusXL Prometheus metrics",
    `# Generated at ${new Date().toISOString()}`
  ];
  const emitted = new Set<string>();

  for (const sample of samples) {
    if (!emitted.has(sample.name)) {
      lines.push(`# HELP ${sample.name} ${sample.help}`);
      lines.push(`# TYPE ${sample.name} ${sample.type}`);
      emitted.add(sample.name);
    }
    lines.push(`${sample.name}${labelText(sample.labels)} ${finite(sample.value)}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function collectPrometheusMetrics() {
  const startedAt = performance.now();
  const tasks = listTasks();
  const taskCounts = new Map<TaskStatus, number>(taskStatuses.map((status) => [status, 0]));

  for (const task of tasks) {
    taskCounts.set(task.status, (taskCounts.get(task.status) ?? 0) + 1);
  }

  const terminalTasks = tasks.filter((task) => terminalTaskStatuses.has(task.status));
  const taskDurations = terminalTasks.map(taskDurationSeconds);
  const completedTasks = taskCounts.get("completed") ?? 0;
  const failedTasks = (taskCounts.get("failed") ?? 0) + (taskCounts.get("timeout") ?? 0);
  const avgDuration =
    taskDurations.length > 0
      ? taskDurations.reduce((sum, value) => sum + value, 0) / taskDurations.length
      : 0;
  const successRate = terminalTasks.length > 0 ? completedTasks / terminalTasks.length : 0;
  const failureRate = terminalTasks.length > 0 ? failedTasks / terminalTasks.length : 0;

  const llmSummary = getContextMetricsSummary();
  const lastHourMetrics = listContextMetricsInRange(oneHourAgoIso(), new Date().toISOString(), 5000);
  const lastHourCostUsd = lastHourMetrics.reduce((sum, metric) => sum + metric.estimatedCostUsd, 0);
  const llmFallbacks = lastHourMetrics.filter((metric) => metric.fallbackUsed).length;
  const llmErrorRate = lastHourMetrics.length > 0 ? llmFallbacks / lastHourMetrics.length : 0;
  const auditTotal = listAuditLogs({ limit: 1 }).total;
  const auditChain = verifyAuditChain();
  const sandbox = await getCachedSandboxStatus();

  const samples: MetricSample[] = [
    {
      name: "manusxl_build_info",
      help: "ManusXL build information. A value of 1 means the exporter is running.",
      type: "gauge",
      value: 1,
      labels: { app: "manusxl-next", version: "0.1.0" }
    },
    {
      name: "manusxl_tasks_total",
      help: "Total number of persisted ManusXL tasks.",
      type: "gauge",
      value: tasks.length
    },
    {
      name: "manusxl_tasks_active",
      help: "Number of queued or running ManusXL tasks.",
      type: "gauge",
      value: (taskCounts.get("queued") ?? 0) + (taskCounts.get("running") ?? 0)
    },
    {
      name: "manusxl_task_success_rate",
      help: "Completed terminal tasks divided by all terminal tasks.",
      type: "gauge",
      value: successRate
    },
    {
      name: "manusxl_task_failure_rate",
      help: "Failed or timeout terminal tasks divided by all terminal tasks.",
      type: "gauge",
      value: failureRate
    },
    {
      name: "manusxl_task_duration_seconds_avg",
      help: "Average duration in seconds for terminal tasks.",
      type: "gauge",
      value: avgDuration
    },
    {
      name: "manusxl_task_duration_seconds_p99",
      help: "P99 duration in seconds for terminal tasks.",
      type: "gauge",
      value: percentile(taskDurations, 0.99)
    },
    {
      name: "manusxl_llm_calls_total",
      help: "Total persisted LLM calls.",
      type: "counter",
      value: llmSummary.totalCalls
    },
    {
      name: "manusxl_llm_tokens_total",
      help: "Total persisted LLM tokens.",
      type: "counter",
      value: llmSummary.totalTokens
    },
    {
      name: "manusxl_llm_estimated_cost_usd_total",
      help: "Total estimated persisted LLM cost in USD.",
      type: "counter",
      value: llmSummary.estimatedCostUsd
    },
    {
      name: "manusxl_llm_estimated_cost_usd_per_minute",
      help: "Estimated LLM cost in USD per minute over the last hour.",
      type: "gauge",
      value: lastHourCostUsd / 60
    },
    {
      name: "manusxl_llm_fallback_total",
      help: "LLM calls over the last hour that used local fallback.",
      type: "counter",
      value: llmFallbacks
    },
    {
      name: "manusxl_llm_error_rate",
      help: "Fallback calls divided by all LLM calls over the last hour.",
      type: "gauge",
      value: llmErrorRate
    },
    {
      name: "manusxl_audit_logs_total",
      help: "Total number of audit log entries.",
      type: "gauge",
      value: auditTotal
    },
    {
      name: "manusxl_audit_chain_ok",
      help: "System audit hash chain verification status, 1 for ok and 0 for broken.",
      type: "gauge",
      value: auditChain.ok ? 1 : 0
    },
    {
      name: "manusxl_sandbox_pool_containers",
      help: "Number of currently pooled sandbox containers.",
      type: "gauge",
      value: sandbox.pool.length
    },
    {
      name: "manusxl_sandbox_docker_available",
      help: "Docker daemon availability for sandbox execution, 1 for available and 0 for unavailable.",
      type: "gauge",
      value: sandbox.dockerAvailable ? 1 : 0
    },
    {
      name: "manusxl_sandbox_image_available",
      help: "Configured sandbox image availability, 1 for available and 0 for unavailable.",
      type: "gauge",
      value: sandbox.imageAvailable ? 1 : 0
    },
    {
      name: "manusxl_sandbox_network_enabled",
      help: "Sandbox network setting, 1 for enabled and 0 for disabled.",
      type: "gauge",
      value: sandbox.networkEnabled ? 1 : 0
    }
  ];

  for (const status of taskStatuses) {
    samples.push({
      name: "manusxl_tasks_by_status",
      help: "Number of tasks grouped by stable task status.",
      type: "gauge",
      value: taskCounts.get(status) ?? 0,
      labels: { status }
    });
  }

  for (const status of auditStatuses) {
    samples.push({
      name: "manusxl_audit_logs_by_status",
      help: "Number of audit logs grouped by stable audit status.",
      type: "gauge",
      value: listAuditLogs({ status, limit: 1 }).total,
      labels: { status }
    });
  }

  samples.push({
    name: "manusxl_metrics_collect_duration_ms",
    help: "Wall-clock time spent collecting Prometheus metrics.",
    type: "gauge",
    value: performance.now() - startedAt
  });

  return renderMetricSamples(samples);
}
