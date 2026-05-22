import { getAppConfig } from "@/server/config/app-config";

export type ModelRouteStage = "planning" | "execution" | "final_answer";

export interface ModelRouteDecision {
  stage: ModelRouteStage;
  model: string;
  reason: string;
}

function isComplexPrompt(prompt: string) {
  return /深度|复杂|研究|调研|分析|报告|多步骤|dashboard|ppt|excel|代码|文件|pdf/i.test(prompt);
}

export function routeModel(stage: ModelRouteStage, prompt: string): ModelRouteDecision {
  const config = getAppConfig();
  const baseModel = config.model;
  const stageModel =
    stage === "planning"
      ? config.planningModel
      : stage === "final_answer"
        ? config.finalModel
        : config.executionModel;

  const model = stageModel || baseModel;
  const complexity = isComplexPrompt(prompt) ? "复杂任务" : "普通任务";
  const reason =
    model === baseModel
      ? `${complexity}，沿用默认模型 ${baseModel}`
      : `${complexity}，${stage} 阶段路由到 ${model}`;

  return {
    stage,
    model,
    reason
  };
}
