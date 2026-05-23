import { getAppConfig } from "@/server/config/app-config";
import { recommendDynamicModelRoute } from "@/server/llm/router-optimizer";

export type ModelRouteStage = "planning" | "execution" | "final_answer";

export interface ModelRouteDecision {
  stage: ModelRouteStage;
  model: string;
  reason: string;
  source?: "static" | "optimizer" | "manual";
  taskType?: string;
  confidence?: number;
  sampleSize?: number;
}

export interface ModelRoutePolicy {
  baseModel: string;
  planningModel?: string;
  executionModel?: string;
  finalModel?: string;
}

function isComplexPrompt(prompt: string) {
  return /深度|复杂|研究|调研|分析|报告|多步骤|dashboard|ppt|excel|代码|文件|pdf/i.test(prompt);
}

export function routeModelWithPolicy(
  stage: ModelRouteStage,
  prompt: string,
  policy: ModelRoutePolicy
): ModelRouteDecision {
  const baseModel = policy.baseModel;
  const stageModel =
    stage === "planning"
      ? policy.planningModel
      : stage === "final_answer"
        ? policy.finalModel
        : policy.executionModel;

  const model = stageModel || baseModel;
  const complexity = isComplexPrompt(prompt) ? "复杂任务" : "普通任务";
  const reason =
    model === baseModel
      ? `${complexity}，沿用默认模型 ${baseModel}`
      : `${complexity}，${stage} 阶段路由到 ${model}`;

  return {
    stage,
    model,
    reason,
    source: "static"
  };
}

export function routeModel(stage: ModelRouteStage, prompt: string, ownerId?: string): ModelRouteDecision {
  const config = getAppConfig();
  const staticDecision = routeModelWithPolicy(stage, prompt, {
    baseModel: config.model,
    planningModel: config.planningModel,
    executionModel: config.executionModel,
    finalModel: config.finalModel
  });
  const manualOverride =
    config.planningModel !== config.model ||
    config.executionModel !== config.model ||
    config.finalModel !== config.model;

  if (manualOverride) {
    return {
      ...staticDecision,
      source: "manual"
    };
  }

  const dynamicRoute = recommendDynamicModelRoute(stage, prompt, ownerId);
  if (!dynamicRoute || dynamicRoute.model === staticDecision.model) {
    return {
      ...staticDecision,
      source: dynamicRoute?.source === "manual" ? "manual" : staticDecision.source,
      confidence: dynamicRoute?.confidence,
      sampleSize: dynamicRoute?.sampleSize
    };
  }

  return {
    stage,
    model: dynamicRoute.model,
    reason: `动态优化：${dynamicRoute.reason}`,
    source: "optimizer",
    confidence: dynamicRoute.confidence,
    sampleSize: dynamicRoute.sampleSize
  };
}
