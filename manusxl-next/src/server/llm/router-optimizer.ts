import { estimateCost } from "@/server/billing/pricing";
import { getAppConfig } from "@/server/config/app-config";
import { listContextMetricsInRange } from "@/server/metrics/context-metrics";
import { listTasks } from "@/server/tasks/task-store";
import type { ModelRouteStage } from "@/server/llm/model-router";
import type {
  ContextMetric,
  ModelRouterAbTestSnapshot,
  ModelRouterOptimizerResponse,
  ModelRouterPolicySnapshot,
  ModelRouterStage,
  ModelRouterStageRecommendation,
  ModelRouterTaskType,
  ModelRouterTaskTypeRecommendation,
  Task
} from "@/types/agent";

type StageStats = Map<string, ModelStats>;

interface ModelStats {
  model: string;
  sampleSize: number;
  successSignals: number;
  qualitySignals: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  fallbackCount: number;
}

interface TaskTypeBucket {
  taskType: ModelRouterTaskType;
  label: string;
  taskCount: number;
  metrics: ContextMetric[];
  stageStats: Record<ModelRouterStage, StageStats>;
}

interface PolicyModels {
  planning: string;
  execution: string;
  finalAnswer: string;
}

const taskTypeLabels: Record<ModelRouterTaskType, string> = {
  research: "调研/报告",
  data: "数据/表格",
  file: "文件处理",
  browser: "浏览器/网页",
  design: "设计/多媒体",
  coding: "代码/产品",
  general: "通用任务"
};

const modelCapabilityScore: Record<string, number> = {
  "deepseek-v4-pro": 1,
  "deepseek-chat": 0.9,
  "deepseek-v4-flash": 0.82,
  "deepseek-v4-mini": 0.65
};

const optimizerCache = globalThis as unknown as {
  manusxlRouterOptimizerCache?: {
    key: string;
    expiresAt: number;
    value: ModelRouterOptimizerResponse;
  };
};

function stageKey(stage: string | undefined): ModelRouterStage {
  if (stage === "plan" || stage === "planning") return "planning";
  if (stage === "final_answer") return "final_answer";
  return "execution";
}

function policyKey(stage: ModelRouterStage) {
  return stage === "final_answer" ? "finalAnswer" : stage;
}

export function classifyModelRouterTask(prompt: string): ModelRouterTaskType {
  if (/调研|研究|竞品|市场|报告|对比|行业|research|competitor|market/i.test(prompt)) {
    return "research";
  }
  if (/csv|excel|xlsx|表格|数据|图表|dashboard|分析|统计|sql/i.test(prompt)) {
    return "data";
  }
  if (/文件|目录|批量|重命名|移动|查重|压缩|zip|pdf|docx|上传/i.test(prompt)) {
    return "file";
  }
  if (/网页|浏览器|网站|页面|爬取|搜索|browser|web|url|链接/i.test(prompt)) {
    return "browser";
  }
  if (/图片|图像|设计|海报|视频|3d|素材|design|image|poster/i.test(prompt)) {
    return "design";
  }
  if (/代码|应用|app|api|组件|前端|后端|部署|github|repo|typescript|python/i.test(prompt)) {
    return "coding";
  }
  return "general";
}

function qualitySignal(task: Task) {
  if (task.status === "completed") return 1;
  if (task.status === "failed" || task.status === "timeout") return 0;
  if (task.status === "cancelled") return 0.35;
  return 0.5;
}

function taskSuccessSignal(task: Task) {
  return task.status === "completed" ? 1 : 0;
}

function fallbackPolicyForTaskType(taskType: ModelRouterTaskType, baseModel: string): PolicyModels {
  switch (taskType) {
    case "research":
    case "coding":
      return {
        planning: "deepseek-v4-pro",
        execution: "deepseek-v4-flash",
        finalAnswer: "deepseek-v4-flash"
      };
    case "data":
    case "design":
      return {
        planning: "deepseek-v4-pro",
        execution: "deepseek-v4-flash",
        finalAnswer: "deepseek-v4-flash"
      };
    case "file":
      return {
        planning: baseModel,
        execution: "deepseek-v4-mini",
        finalAnswer: baseModel
      };
    case "browser":
      return {
        planning: baseModel,
        execution: "deepseek-v4-flash",
        finalAnswer: baseModel
      };
    default:
      return {
        planning: baseModel,
        execution: baseModel,
        finalAnswer: baseModel
      };
  }
}

function emptyStageStats(): Record<ModelRouterStage, StageStats> {
  return {
    planning: new Map(),
    execution: new Map(),
    final_answer: new Map()
  };
}

function createBuckets() {
  const buckets = new Map<ModelRouterTaskType, TaskTypeBucket>();
  (Object.keys(taskTypeLabels) as ModelRouterTaskType[]).forEach((taskType) => {
    buckets.set(taskType, {
      taskType,
      label: taskTypeLabels[taskType],
      taskCount: 0,
      metrics: [],
      stageStats: emptyStageStats()
    });
  });
  return buckets;
}

function addModelStats(
  stats: StageStats,
  metric: ContextMetric,
  task: Task
) {
  const existing =
    stats.get(metric.model) ?? {
      model: metric.model,
      sampleSize: 0,
      successSignals: 0,
      qualitySignals: 0,
      totalCostUsd: 0,
      totalLatencyMs: 0,
      fallbackCount: 0
    };
  existing.sampleSize += 1;
  existing.successSignals += taskSuccessSignal(task);
  existing.qualitySignals += qualitySignal(task);
  existing.totalCostUsd += metric.estimatedCostUsd ?? 0;
  existing.totalLatencyMs += metric.latencyMs;
  existing.fallbackCount += metric.fallbackUsed ? 1 : 0;
  stats.set(metric.model, existing);
}

function averageCost(stats: ModelStats) {
  return stats.sampleSize > 0 ? stats.totalCostUsd / stats.sampleSize : 0;
}

function successRate(stats: ModelStats) {
  return stats.sampleSize > 0 ? stats.successSignals / stats.sampleSize : 0;
}

function averageQuality(stats: ModelStats) {
  return stats.sampleSize > 0 ? stats.qualitySignals / stats.sampleSize : 0;
}

function recommendationFromStats(
  stage: ModelRouterStage,
  bucket: TaskTypeBucket
): ModelRouterStageRecommendation | undefined {
  const stats = Array.from(bucket.stageStats[stage].values()).filter((item) => item.sampleSize >= 2);
  if (stats.length === 0) return undefined;

  const maxCost = Math.max(...stats.map((item) => averageCost(item)), 0.000001);
  const maxLatency = Math.max(...stats.map((item) => item.totalLatencyMs / item.sampleSize), 1);
  const ranked = stats
    .map((item) => {
      const costScore = 1 - Math.min(1, averageCost(item) / maxCost);
      const latencyScore = 1 - Math.min(1, item.totalLatencyMs / item.sampleSize / maxLatency);
      const fallbackPenalty = item.fallbackCount > 0 ? Math.min(0.12, item.fallbackCount / item.sampleSize / 5) : 0;
      const score =
        averageQuality(item) * 0.45 +
        successRate(item) * 0.25 +
        costScore * 0.2 +
        latencyScore * 0.1 -
        fallbackPenalty;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.item;
  if (!best) return undefined;

  const sampleConfidence = Math.min(0.85, 0.45 + best.sampleSize * 0.06);
  const qualityConfidence = Math.min(0.1, averageQuality(best) * 0.1);
  return {
    stage,
    model: best.model,
    reason: `${bucket.label} 历史样本中 ${best.model} 在 ${stage} 阶段综合质量、成本和延迟得分最高。`,
    confidence: Number(Math.min(0.95, sampleConfidence + qualityConfidence).toFixed(2)),
    sampleSize: best.sampleSize,
    averageCostUsd: Number(averageCost(best).toFixed(8)),
    successRate: Number(successRate(best).toFixed(4)),
    source: "history"
  };
}

function fallbackRecommendation(
  stage: ModelRouterStage,
  taskType: ModelRouterTaskType,
  model: string
): ModelRouterStageRecommendation {
  return {
    stage,
    model,
    reason: `${taskTypeLabels[taskType]} 样本不足，使用保守决策树：复杂规划优先强模型，执行阶段优先低成本模型。`,
    confidence: taskType === "general" ? 0.46 : 0.58,
    sampleSize: 0,
    averageCostUsd: 0,
    successRate: 0,
    source: "fallback"
  };
}

function buildRecommendation(bucket: TaskTypeBucket, baseModel: string): ModelRouterTaskTypeRecommendation {
  const fallback = fallbackPolicyForTaskType(bucket.taskType, baseModel);
  const planning =
    recommendationFromStats("planning", bucket) ??
    fallbackRecommendation("planning", bucket.taskType, fallback.planning);
  const execution =
    recommendationFromStats("execution", bucket) ??
    fallbackRecommendation("execution", bucket.taskType, fallback.execution);
  const finalAnswer =
    recommendationFromStats("final_answer", bucket) ??
    fallbackRecommendation("final_answer", bucket.taskType, fallback.finalAnswer);
  const metricCount = bucket.metrics.length;

  return {
    taskType: bucket.taskType,
    label: bucket.label,
    taskCount: bucket.taskCount,
    metricCount,
    dataSufficient:
      bucket.taskCount >= 3 &&
      [planning, execution, finalAnswer].some((item) => item.source === "history"),
    policy: {
      planning,
      execution,
      finalAnswer
    }
  };
}

function costForMetricWithModel(metric: ContextMetric, model: string) {
  return estimateCost({
    model,
    promptTokens: metric.promptTokens,
    completionTokens: metric.completionTokens,
    cacheReadTokens: metric.cacheReadTokens
  }).estimatedCostUsd;
}

function stageModel(policy: PolicyModels, stage: ModelRouterStage) {
  if (stage === "planning") return policy.planning;
  if (stage === "final_answer") return policy.finalAnswer;
  return policy.execution;
}

function predictedQuality(task: Task, policy: PolicyModels) {
  const base = qualitySignal(task);
  const taskType = classifyModelRouterTask(task.prompt);
  const requiredCapability =
    taskType === "research" || taskType === "coding" || taskType === "data" ? 0.85 : 0.7;
  const planningCapability = modelCapabilityScore[policy.planning] ?? 0.72;
  const finalCapability = modelCapabilityScore[policy.finalAnswer] ?? 0.72;
  const lift =
    Math.max(-0.08, Math.min(0.08, (planningCapability - requiredCapability) * 0.08)) +
    Math.max(-0.05, Math.min(0.05, (finalCapability - 0.78) * 0.05));
  return Math.max(0, Math.min(1, base + lift));
}

function buildAbTest(
  tasks: Task[],
  metrics: ContextMetric[],
  currentPolicy: PolicyModels,
  candidatePolicy: PolicyModels
): ModelRouterAbTestSnapshot {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const eligibleMetrics = metrics.filter((metric) => metric.taskId && taskById.has(metric.taskId));
  const sampleTasks = tasks.filter((task) => eligibleMetrics.some((metric) => metric.taskId === task.id));

  if (eligibleMetrics.length < 2 || sampleTasks.length < 1) {
    return {
      sampleSize: sampleTasks.length,
      baselineCostUsd: 0,
      candidateCostUsd: 0,
      costSavingsRate: 0,
      baselineQualityScore: 0,
      candidateQualityScore: 0,
      qualityDelta: 0,
      winner: "insufficient_data",
      notes: ["最近 LLM 调用样本不足，当前只展示基于规则的推荐。"]
    };
  }

  const baselineCostUsd = eligibleMetrics.reduce((sum, metric) => {
    return sum + costForMetricWithModel(metric, stageModel(currentPolicy, stageKey(metric.stage)));
  }, 0);
  const candidateCostUsd = eligibleMetrics.reduce((sum, metric) => {
    return sum + costForMetricWithModel(metric, stageModel(candidatePolicy, stageKey(metric.stage)));
  }, 0);
  const baselineQualityScore =
    sampleTasks.reduce((sum, task) => sum + predictedQuality(task, currentPolicy), 0) / sampleTasks.length;
  const candidateQualityScore =
    sampleTasks.reduce((sum, task) => sum + predictedQuality(task, candidatePolicy), 0) / sampleTasks.length;
  const costSavingsRate =
    baselineCostUsd > 0 ? Math.max(-1, (baselineCostUsd - candidateCostUsd) / baselineCostUsd) : 0;
  const qualityDelta = candidateQualityScore - baselineQualityScore;
  const winner =
    costSavingsRate >= 0.15 && qualityDelta >= -0.02
      ? "candidate"
      : "baseline";

  return {
    sampleSize: sampleTasks.length,
    baselineCostUsd: Number(baselineCostUsd.toFixed(8)),
    candidateCostUsd: Number(candidateCostUsd.toFixed(8)),
    costSavingsRate: Number(costSavingsRate.toFixed(4)),
    baselineQualityScore: Number((baselineQualityScore * 100).toFixed(2)),
    candidateQualityScore: Number((candidateQualityScore * 100).toFixed(2)),
    qualityDelta: Number((qualityDelta * 100).toFixed(2)),
    winner,
    notes: [
      "A/B 回放使用最近任务的真实 token 分布，重算当前策略与推荐策略成本。",
      "质量分基于任务终态、规划/总结模型能力和任务类型需求做保守估算，推荐先人工确认后应用。"
    ]
  };
}

function policyFromRecommendation(policy: ModelRouterPolicySnapshot): PolicyModels {
  return {
    planning: policy.planning.model,
    execution: policy.execution.model,
    finalAnswer: policy.finalAnswer.model
  };
}

function buildOptimizerSnapshot(ownerId?: string, prompt = ""): ModelRouterOptimizerResponse {
  const startedAt = Date.now();
  const config = getAppConfig();
  const now = Date.now();
  const startIso = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
  const endIso = new Date(now + 60 * 1000).toISOString();
  const tasks = listTasks(undefined, ownerId).slice(0, 300);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const metrics = listContextMetricsInRange(startIso, endIso, 5000).filter(
    (metric) => !!metric.taskId && taskById.has(metric.taskId)
  );
  const buckets = createBuckets();

  tasks.forEach((task) => {
    const taskType = classifyModelRouterTask(task.prompt);
    const bucket = buckets.get(taskType);
    if (bucket) bucket.taskCount += 1;
  });

  metrics.forEach((metric) => {
    if (!metric.taskId) return;
    const task = taskById.get(metric.taskId);
    if (!task) return;
    const taskType = classifyModelRouterTask(task.prompt);
    const bucket = buckets.get(taskType);
    if (!bucket) return;
    bucket.metrics.push(metric);
    addModelStats(bucket.stageStats[stageKey(metric.stage)], metric, task);
  });

  const byTaskType = Array.from(buckets.values())
    .map((bucket) => buildRecommendation(bucket, config.model))
    .sort((a, b) => b.metricCount - a.metricCount || b.taskCount - a.taskCount);
  const selectedTaskType = prompt ? classifyModelRouterTask(prompt) : byTaskType[0]?.taskType ?? "general";
  const recommendation =
    byTaskType.find((item) => item.taskType === selectedTaskType) ??
    buildRecommendation(
      {
        taskType: selectedTaskType,
        label: taskTypeLabels[selectedTaskType],
        taskCount: 0,
        metrics: [],
        stageStats: emptyStageStats()
      },
      config.model
    );
  const currentPolicy: PolicyModels = {
    planning: config.planningModel,
    execution: config.executionModel,
    finalAnswer: config.finalModel
  };
  const candidatePolicy = policyFromRecommendation(recommendation.policy);
  const manualOverride =
    config.planningModel !== config.model ||
    config.executionModel !== config.model ||
    config.finalModel !== config.model;

  return {
    generatedAt: new Date().toISOString(),
    selectedTaskType,
    selectedLabel: taskTypeLabels[selectedTaskType],
    latencyMs: Date.now() - startedAt,
    currentPolicy: {
      baseModel: config.model,
      planningModel: config.planningModel,
      executionModel: config.executionModel,
      finalModel: config.finalModel,
      manualOverride
    },
    recommendation,
    byTaskType,
    abTest: buildAbTest(tasks, metrics, currentPolicy, candidatePolicy),
    fallbackReason: recommendation.dataSufficient
      ? undefined
      : "当前任务类型历史样本不足，已回退到保守规则。"
  };
}

export function getRouterOptimizerSnapshot(ownerId?: string, prompt = ""): ModelRouterOptimizerResponse {
  const cacheKey = `${ownerId ?? "anonymous"}:${classifyModelRouterTask(prompt)}`;
  const cached = optimizerCache.manusxlRouterOptimizerCache;
  if (cached && cached.key === cacheKey && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = buildOptimizerSnapshot(ownerId, prompt);
  optimizerCache.manusxlRouterOptimizerCache = {
    key: cacheKey,
    expiresAt: Date.now() + 10_000,
    value
  };
  return value;
}

export function recommendDynamicModelRoute(
  stage: ModelRouteStage,
  prompt: string,
  ownerId?: string
): ModelRouterStageRecommendation | undefined {
  const config = getAppConfig();
  const manualStageModel =
    stage === "planning"
      ? config.planningModel
      : stage === "final_answer"
        ? config.finalModel
        : config.executionModel;

  if (manualStageModel && manualStageModel !== config.model) {
    return {
      stage: stage === "final_answer" ? "final_answer" : stage,
      model: manualStageModel,
      reason: "用户已手动覆盖该阶段模型，动态优化器不接管。",
      confidence: 1,
      sampleSize: 0,
      averageCostUsd: 0,
      successRate: 1,
      source: "manual"
    };
  }

  const snapshot = getRouterOptimizerSnapshot(ownerId, prompt);
  const key = policyKey(stage === "final_answer" ? "final_answer" : stage);
  return snapshot.recommendation.policy[key];
}
