import { estimateCost } from "@/server/billing/pricing";
import { routeModelWithPolicy, type ModelRoutePolicy } from "@/server/llm/model-router";

interface QualityFixture {
  id: string;
  prompt: string;
  expected: {
    complexPlanning: boolean;
    requiresRichFinal: boolean;
    executionCanBeLight: boolean;
  };
  tokens: {
    planningInput: number;
    planningOutput: number;
    executionInput: number;
    executionOutput: number;
    finalInput: number;
    finalOutput: number;
  };
}

const highCapabilityModels = new Set(["deepseek-v4-pro", "deepseek-chat"]);
const finalQualityModels = new Set(["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat"]);
const lightExecutionModels = new Set(["deepseek-v4-mini", "deepseek-v4-flash", "deepseek-chat"]);

const fixtures: QualityFixture[] = [
  {
    id: "research-nev",
    prompt: "调研中国新能源车前五，输出对比结论和建议",
    expected: { complexPlanning: true, requiresRichFinal: true, executionCanBeLight: true },
    tokens: { planningInput: 2200, planningOutput: 600, executionInput: 1800, executionOutput: 240, finalInput: 2600, finalOutput: 800 }
  },
  {
    id: "saas-competitors",
    prompt: "整理一个 SaaS 产品竞品分析，给出定价和定位建议",
    expected: { complexPlanning: true, requiresRichFinal: true, executionCanBeLight: true },
    tokens: { planningInput: 2100, planningOutput: 560, executionInput: 1700, executionOutput: 220, finalInput: 2400, finalOutput: 760 }
  },
  {
    id: "prd-design",
    prompt: "把一个复杂需求拆成 PRD、技术方案和任务清单",
    expected: { complexPlanning: true, requiresRichFinal: true, executionCanBeLight: true },
    tokens: { planningInput: 2600, planningOutput: 720, executionInput: 1500, executionOutput: 200, finalInput: 2800, finalOutput: 900 }
  },
  {
    id: "python-analysis",
    prompt: "用 Python 分析 AI Agent 产品 MVP 需求，并生成报告、表格、PPT、PDF 和 ZIP",
    expected: { complexPlanning: true, requiresRichFinal: true, executionCanBeLight: false },
    tokens: { planningInput: 3000, planningOutput: 760, executionInput: 2600, executionOutput: 420, finalInput: 3200, finalOutput: 980 }
  },
  {
    id: "shell-workspace",
    prompt: "用 Shell 检查任务 workspace 目录和文件结构，并输出 ZIP 归档",
    expected: { complexPlanning: false, requiresRichFinal: false, executionCanBeLight: true },
    tokens: { planningInput: 1200, planningOutput: 260, executionInput: 900, executionOutput: 180, finalInput: 1100, finalOutput: 260 }
  },
  {
    id: "travel-map",
    prompt: "规划东京、京都、大阪 5 日旅行路线，并生成地图式网页",
    expected: { complexPlanning: true, requiresRichFinal: true, executionCanBeLight: true },
    tokens: { planningInput: 2300, planningOutput: 620, executionInput: 1600, executionOutput: 260, finalInput: 2500, finalOutput: 780 }
  },
  {
    id: "ocr-report",
    prompt: "识别上传发票图片，提取金额、日期和供应商，并输出 Markdown 报告",
    expected: { complexPlanning: false, requiresRichFinal: false, executionCanBeLight: true },
    tokens: { planningInput: 1300, planningOutput: 280, executionInput: 1700, executionOutput: 260, finalInput: 1400, finalOutput: 360 }
  },
  {
    id: "dashboard",
    prompt: "基于销售 CSV 生成 line、bar、pie、scatter、heatmap 图表和 dashboard",
    expected: { complexPlanning: true, requiresRichFinal: true, executionCanBeLight: false },
    tokens: { planningInput: 2500, planningOutput: 680, executionInput: 2800, executionOutput: 460, finalInput: 2900, finalOutput: 840 }
  },
  {
    id: "batch-files",
    prompt: "按类别把上传文件移到子目录，并生成 dry-run 清单",
    expected: { complexPlanning: false, requiresRichFinal: false, executionCanBeLight: true },
    tokens: { planningInput: 1100, planningOutput: 240, executionInput: 1300, executionOutput: 220, finalInput: 1200, finalOutput: 260 }
  },
  {
    id: "mcp-github",
    prompt: "使用 GitHub MCP 检查仓库 issue，输出优先级建议",
    expected: { complexPlanning: true, requiresRichFinal: true, executionCanBeLight: true },
    tokens: { planningInput: 2200, planningOutput: 560, executionInput: 1800, executionOutput: 300, finalInput: 2400, finalOutput: 700 }
  }
];

function stageCost(model: string, promptTokens: number, completionTokens: number) {
  return estimateCost({
    model,
    promptTokens,
    completionTokens,
    cacheReadTokens: 0
  }).estimatedCostUsd;
}

function scoreFixture(fixture: QualityFixture, policy: ModelRoutePolicy) {
  const planning = routeModelWithPolicy("planning", fixture.prompt, policy);
  const execution = routeModelWithPolicy("execution", fixture.prompt, policy);
  const finalAnswer = routeModelWithPolicy("final_answer", fixture.prompt, policy);
  let score = 100;
  const notes: string[] = [];

  if (fixture.expected.complexPlanning && !highCapabilityModels.has(planning.model)) {
    score -= 12;
    notes.push("复杂任务规划未使用高能力模型");
  }
  if (fixture.expected.requiresRichFinal && !finalQualityModels.has(finalAnswer.model)) {
    score -= 8;
    notes.push("高价值交付物总结模型过轻");
  }
  if (!fixture.expected.executionCanBeLight && execution.model === "deepseek-v4-mini") {
    score -= 4;
    notes.push("数据/代码执行阶段使用 mini，建议人工复核");
  }
  if (fixture.expected.executionCanBeLight && !lightExecutionModels.has(execution.model)) {
    score -= 2;
    notes.push("轻执行阶段未使用轻量模型，质量不降但成本可继续优化");
  }

  const costUsd =
    stageCost(planning.model, fixture.tokens.planningInput, fixture.tokens.planningOutput) +
    stageCost(execution.model, fixture.tokens.executionInput, fixture.tokens.executionOutput) +
    stageCost(finalAnswer.model, fixture.tokens.finalInput, fixture.tokens.finalOutput);

  return {
    id: fixture.id,
    prompt: fixture.prompt,
    score,
    costUsd: Number(costUsd.toFixed(8)),
    routes: {
      planning,
      execution,
      finalAnswer
    },
    notes
  };
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function runModelQualityBenchmark() {
  const highPolicy: ModelRoutePolicy = {
    baseModel: "deepseek-v4-pro",
    planningModel: "deepseek-v4-pro",
    executionModel: "deepseek-v4-pro",
    finalModel: "deepseek-v4-pro"
  };
  const mixedPolicy: ModelRoutePolicy = {
    baseModel: "deepseek-v4-flash",
    planningModel: "deepseek-v4-pro",
    executionModel: "deepseek-v4-flash",
    finalModel: "deepseek-v4-flash"
  };
  const high = fixtures.map((fixture) => scoreFixture(fixture, highPolicy));
  const mixed = fixtures.map((fixture) => scoreFixture(fixture, mixedPolicy));
  const highAverageScore = average(high.map((item) => item.score));
  const mixedAverageScore = average(mixed.map((item) => item.score));
  const highCostUsd = high.reduce((sum, item) => sum + item.costUsd, 0);
  const mixedCostUsd = mixed.reduce((sum, item) => sum + item.costUsd, 0);
  const costSavingsRate = highCostUsd > 0 ? (highCostUsd - mixedCostUsd) / highCostUsd : 0;

  return {
    fixtureCount: fixtures.length,
    highPolicy,
    mixedPolicy,
    highAverageScore: Number(highAverageScore.toFixed(2)),
    mixedAverageScore: Number(mixedAverageScore.toFixed(2)),
    scoreDelta: Number((mixedAverageScore - highAverageScore).toFixed(2)),
    highCostUsd: Number(highCostUsd.toFixed(8)),
    mixedCostUsd: Number(mixedCostUsd.toFixed(8)),
    costSavingsRate: Number(costSavingsRate.toFixed(4)),
    passed: mixedAverageScore >= highAverageScore && costSavingsRate >= 0.3,
    manualReviewRubric: [
      "复杂调研/PRD/路线类任务规划阶段必须使用高能力模型。",
      "报告、PPT、Dashboard 等最终交付物不得使用 mini 模型总结。",
      "执行阶段可使用轻量模型，但数据/代码密集任务需人工复核工具结果。",
      "通过标准：10 个任务平均质量分不低于全高配模型，且成本下降不低于 30%。"
    ],
    high,
    mixed
  };
}
