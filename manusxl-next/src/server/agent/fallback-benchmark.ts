import {
  executeAgentTool,
  executeAgentToolWithFallback,
  type AgentToolInput,
  type AgentToolName
} from "@/server/agent/tools";

const benchmarkTool: AgentToolName = "web_research";
const benchmarkEnabledTools: AgentToolName[] = [
  "task_planner",
  "web_research",
  "data_analysis",
  "artifact_writer"
];

function clampIterations(value: number) {
  if (!Number.isFinite(value)) return 100;
  return Math.min(500, Math.max(10, Math.round(value)));
}

function benchmarkInput(index: number, failureOverrides: AgentToolInput["failureOverrides"]): AgentToolInput {
  return {
    taskId: `fallback_benchmark_${index}`,
    prompt: "诊断工具降级：主搜索工具失败时，使用备用分析工具完成任务。",
    step: "调研一个市场主题并返回结构化结论",
    stepIndex: index,
    plan: ["调研一个市场主题并返回结构化结论"],
    failureOverrides
  };
}

export async function runFallbackBenchmark(iterationsInput = 100) {
  const iterations = clampIterations(iterationsInput);
  let baselineFailures = 0;
  let fallbackFailures = 0;
  let fallbackUsed = 0;
  const sampleAttempts: Array<{
    requestedTool: AgentToolName;
    attempts: Array<{ toolName: AgentToolName; ok: boolean; observation: string }>;
    observation: string;
  }> = [];

  for (let index = 0; index < iterations; index += 1) {
    const primaryFailure = { web_research: "primary search outage" };
    const baseline = await executeAgentTool(benchmarkTool, benchmarkInput(index, primaryFailure));
    if (!baseline.ok) baselineFailures += 1;

    const fallback = await executeAgentToolWithFallback(
      benchmarkTool,
      benchmarkInput(index, primaryFailure),
      benchmarkEnabledTools
    );
    if (!fallback.ok) fallbackFailures += 1;
    if (fallback.usedFallback) fallbackUsed += 1;
    if (sampleAttempts.length < 3) {
      sampleAttempts.push({
        requestedTool: benchmarkTool,
        attempts: fallback.attempts ?? [],
        observation: fallback.observation
      });
    }
  }

  const allFailed = await executeAgentToolWithFallback(
    benchmarkTool,
    benchmarkInput(iterations + 1, {
      web_research: "primary search outage",
      data_analysis: "analysis fallback outage",
      task_planner: "planner fallback outage"
    }),
    benchmarkEnabledTools
  );
  const baselineFailureRate = baselineFailures / iterations;
  const fallbackFailureRate = fallbackFailures / iterations;
  const failureRateReduction =
    baselineFailureRate > 0 ? (baselineFailureRate - fallbackFailureRate) / baselineFailureRate : 0;

  return {
    iterations,
    benchmarkTool,
    fallbackChain: [benchmarkTool, "data_analysis", "task_planner"] as AgentToolName[],
    baselineFailures,
    fallbackFailures,
    fallbackUsed,
    baselineFailureRate: Number(baselineFailureRate.toFixed(4)),
    fallbackFailureRate: Number(fallbackFailureRate.toFixed(4)),
    failureRateReduction: Number(failureRateReduction.toFixed(4)),
    sampleAttempts,
    allFailed: {
      ok: allFailed.ok,
      observation: allFailed.observation,
      attempts: allFailed.attempts ?? []
    }
  };
}
