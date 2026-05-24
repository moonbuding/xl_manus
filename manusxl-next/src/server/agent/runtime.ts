import { createId } from "@/lib/id";
import { generateDeliverables, type GeneratedArtifact } from "@/server/artifacts/generators";
import { getTaskTimeoutMs } from "@/server/agent/runtime-config";
import {
  appendTaskMemory,
  buildFinalMessages,
  buildPlanningMessages,
  createContextSnapshot,
  ensureTaskMemory,
  formatContextSnapshot,
  readTaskMemory
} from "@/server/agent/context";
import {
  executeAgentToolWithFallback,
  estimateToolMaskingSavings,
  inferToolsForStep,
  pickTool,
  selectToolsForPrompt,
  type AgentToolResult
} from "@/server/agent/tools";
import { chatWithDeepSeek, getDeepSeekConfig, type ChatMessage } from "@/server/llm/deepseek";
import { routeModel } from "@/server/llm/model-router";
import { hasExecutableSkillForPrompt } from "@/server/skills/skill-registry";
import {
  formatContextMetricForEvent,
  getContextMetricsSummary,
  getLatestContextMetric
} from "@/server/metrics/context-metrics";
import {
  addArtifact,
  addTaskEvent,
  getTask,
  isTaskCancelled,
  setFinalAnswer,
  updateTaskStatus
} from "@/server/tasks/task-store";
import { cleanupSandboxForWorkspace } from "@/server/sandbox/docker-sandbox";
import { archiveTmpIfNeeded, taskWorkspacePaths } from "@/server/workspace/task-workspace";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const globalForRuntime = globalThis as unknown as {
  manusxlRunningTasks?: Set<string>;
  manusxlTaskAbortControllers?: Map<string, AbortController>;
};

const DEFAULT_PLAN = [
  "澄清任务目标与交付物",
  "收集并整理关键事实",
  "抽取对比维度和判断依据",
  "生成结构化结论与下一步建议"
];
function formatDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;

  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

function isTaskTimedOut(startedAt: number, timeoutMs: number) {
  return Date.now() - startedAt >= timeoutMs;
}

function timeoutMessage(timeoutMs: number) {
  return `任务执行时间已超过 ${formatDuration(timeoutMs)}，系统已自动停止后续步骤。可以缩小任务范围后重跑。`;
}

function markTaskTimeout(taskId: string, stepIndex: number, timeoutMs: number) {
  const task = getTask(taskId);
  if (!task || ["completed", "failed", "cancelled", "timeout"].includes(task.status)) return;

  const message = timeoutMessage(timeoutMs);
  updateTaskStatus(taskId, "timeout", message);
  addTaskEvent(taskId, {
    type: "failed",
    stepIndex,
    title: "任务超时",
    content: message,
    payload: { timeoutMs }
  });
}

function shouldStopTask(taskId: string, startedAt: number, timeoutMs: number, stepIndex: number) {
  if (isTaskCancelled(taskId)) return true;
  if (!isTaskTimedOut(startedAt, timeoutMs)) return false;
  markTaskTimeout(taskId, stepIndex, timeoutMs);
  return true;
}

function stopForBudgetIfNeeded(taskId: string, stepIndex: number) {
  if (!isBudgetExceeded(taskId)) return false;

  const message = budgetMessage(taskId);
  updateTaskStatus(taskId, "failed", message);
  addTaskEvent(taskId, {
    type: "failed",
    stepIndex,
    title: "预算保护",
    content: message
  });
  return true;
}

function parsePlan(raw: string, maxSteps = 6) {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  const candidate = jsonMatch?.[0] ?? raw;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (typeof parsed === "string" && parsed.trim().startsWith("[")) {
      return parsePlan(parsed, maxSteps);
    }
    if (Array.isArray(parsed)) {
      const steps = parsed
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, maxSteps);
      if (steps.length === 1 && steps[0].startsWith("[")) return parsePlan(steps[0], maxSteps);
      if (steps.length > 0) return steps;
    }
  } catch {
    // Fall back to line parsing below.
  }

  const quotedItems = Array.from(candidate.matchAll(/"((?:\\.|[^"\\]){6,})"/g))
    .map((match) => {
      try {
        return JSON.parse(`"${match[1]}"`) as string;
      } catch {
        return match[1];
      }
    })
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxSteps);

  if (quotedItems.length >= 2) return quotedItems;

  const lines = raw
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, maxSteps);

  return lines.length > 0 ? lines : DEFAULT_PLAN;
}

function ensureFileReadingStep(prompt: string, plan: string[], uploadedFileIds: string[] = []) {
  if (!prompt.includes("[上传文件摘要]") && uploadedFileIds.length === 0) return plan;
  if (plan.some((step) => /上传文件|文件摘要|附件|读取上传|读取附件/i.test(step))) {
    return plan;
  }

  return ["读取上传文件摘要并提取可用信息", ...plan].slice(0, 6);
}

function taskIntentText(prompt: string) {
  const marker = "[上传文件摘要]";
  const markerIndex = prompt.indexOf(marker);
  return markerIndex >= 0 ? prompt.slice(0, markerIndex) : prompt;
}

function ensureMcpStep(prompt: string, plan: string[]) {
  if (!/mcp|外部工具|第三方工具|github|slack|notion|filesystem/i.test(prompt)) return plan;
  if (plan.some((step) => /mcp|外部工具|第三方工具|github|slack|notion|filesystem/i.test(step))) {
    return plan;
  }

  return ["调用已启用的 MCP 工具获取外部上下文", ...plan].slice(0, 6);
}

function ensureWideResearchStep(prompt: string, plan: string[]) {
  if (
    !/wide research|横向调研|并行.*调研|批量调研|子\s*agent|sub[-\s]?agent|spawn_sub_agents|调研\s*(?:前)?(?:\d+|[一二两三四五六七八九十百]+)\s*(?:家|个|双|款|家公司|公司|品牌|供应商|对象)|(?:前|top\s*)(?:\d+|[一二两三四五六七八九十百]+)\s*(?:家|个|双|款|家公司|公司|品牌|供应商|对象)/i.test(
      prompt
    )
  ) {
    return plan;
  }
  if (plan.some((step) => /spawn_sub_agents|wide research|横向调研|子\s*agent|sub[-\s]?agent/i.test(step))) {
    return plan;
  }

  return ["使用 spawn_sub_agents 并行拆分调研对象，并等待子 Agent 汇总结果", ...plan].slice(0, 6);
}

function ensureSlideDeckStep(prompt: string, plan: string[]) {
  if (!/pptx?|powerpoint|slides?|slide deck|幻灯片|演示文稿|路演|bp|投资人|融资|商业计划书|汇报材料|演讲稿/i.test(prompt)) {
    return plan;
  }
  if (plan.some((step) => /slide_deck_builder|pptx?|slides?|幻灯片|演示文稿|配图|讲稿/i.test(step))) {
    return plan;
  }

  return ["使用 slide_deck_builder 生成 5 页以上 PPTX、配图素材、讲稿和结构化大纲", ...plan].slice(0, 6);
}

function ensureWebAppBuilderStep(prompt: string, plan: string[]) {
  if (!/web app|app builder|全栈|可部署|部署|预览|preview|todo|crm|客户管理|后台|管理系统|登录|auth|jwt|react|tailwind|vercel|cloudflare|render/i.test(prompt)) {
    return plan;
  }
  if (plan.some((step) => /web_app_builder|web app|源码包|可预览|部署|登录|todo|crm|全栈/i.test(step))) {
    return plan;
  }

  return ["使用 web_app_builder 生成可预览 Web App、源码包、数据库 schema 和部署重试清单", ...plan].slice(0, 6);
}

function ensureImageGenerationStep(prompt: string, plan: string[]) {
  if (
    !/ai design|generate_image|图片生成|生成.*(图片|图像|插图|配图|海报|封面|视觉|logo)|设计.*(图片|图像|插图|配图|海报|封面|视觉)|商务风格的咖啡店外观|视频生成|3d\s*资产|3D 资产|poster|illustration|image asset/i.test(
      prompt
    )
  ) {
    return plan;
  }
  if (plan.some((step) => /image_generator|generate_image|图片生成|插图|配图|海报|封面|视觉|AI Design/i.test(step))) {
    return plan;
  }

  return ["使用 image_generator 生成 AI Design 图片素材，并输出 PNG/SVG/manifest 交付物", ...plan].slice(0, 6);
}

function ensureBatchFileOpsStep(prompt: string, plan: string[]) {
  if (!/批量|重命名|分类|移动|整理文件|rename|classify/i.test(prompt)) return plan;
  if (plan.some((step) => /批量|重命名|分类|移动|整理文件|batch_file_ops|rename|classify/i.test(step))) {
    return plan;
  }

  return ["生成上传文件的批量重命名和分类 dry-run 清单", ...plan].slice(0, 6);
}

function ensureImageProcessStep(prompt: string, plan: string[]) {
  if (!/(图片|照片|image|photo).*(压缩|缩放|旋转|格式转换|转成|convert|resize|compress)|(压缩|缩放|旋转|格式转换|转成|convert|resize|compress).*(图片|照片|image|photo)/i.test(prompt)) {
    return plan;
  }
  if (plan.some((step) => /图片|照片|batch_image_process|压缩|缩放|旋转|格式转换|convert|resize|compress/i.test(step))) {
    return plan;
  }

  return ["批量处理上传图片并生成压缩/转换结果包", ...plan].slice(0, 6);
}

function ensureImageOcrStep(prompt: string, plan: string[]) {
  if (!/ocr|文字识别|识别.*(图片|照片|发票|名片|扫描|文字)|提取.*(图片|照片).*文字|发票|名片/i.test(prompt)) {
    return plan;
  }
  if (plan.some((step) => /ocr|image_ocr|文字识别|识别.*文字|提取.*文字|发票|名片/i.test(step))) {
    return plan;
  }

  return ["OCR 识别上传图片文字并生成提取报告", ...plan].slice(0, 6);
}

function ensureMapStep(prompt: string, plan: string[]) {
  if (!/地图|路线|行程|旅行|旅游|门店|地址|附近|周边|导航|map|route|itinerary|location/i.test(prompt)) {
    return plan;
  }
  if (plan.some((step) => /地图|路线|行程|地点|map_planner|route|itinerary/i.test(step))) {
    return plan;
  }

  return ["生成地点顺序、路线段和地图式 HTML 交付物", ...plan].slice(0, 6);
}

function ensureSkillRunnerStep(prompt: string, ownerId: string | undefined, plan: string[]) {
  if (!hasExecutableSkillForPrompt(prompt, ownerId)) return plan;
  if (plan.some((step) => /skill_runner|Skill 脚本|本地 Skill|自定义 Skill/i.test(step))) {
    return plan;
  }

  return ["执行匹配到的本地 Skill 脚本并读取沙盒结果", ...plan].slice(0, 6);
}

async function generatePlan(
  taskId: string,
  prompt: string,
  model: string,
  messages: ChatMessage[],
  ownerId?: string,
  uploadedFileIds: string[] = [],
  signal?: AbortSignal
) {
  const fallback = JSON.stringify(DEFAULT_PLAN);
  const config = getDeepSeekConfig();
  const raw = await chatWithDeepSeek({
    taskId,
    stage: "plan",
    model,
    temperature: Math.min(config.temperature, 0.3),
    maxTokens: 700,
    fallback,
    signal,
    messages
  });
  const intent = taskIntentText(prompt);

  return ensureSkillRunnerStep(
    intent,
    ownerId,
    ensureWebAppBuilderStep(
      intent,
      ensureImageGenerationStep(
        intent,
        ensureSlideDeckStep(
          intent,
          ensureWideResearchStep(
            intent,
            ensureMapStep(
              intent,
              ensureMcpStep(
                intent,
                ensureBatchFileOpsStep(
                  intent,
                  ensureImageOcrStep(
                    intent,
                    ensureImageProcessStep(
                      intent,
                      ensureFileReadingStep(prompt, parsePlan(raw, config.maxSteps), uploadedFileIds)
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}

async function generateFinalAnswer(
  taskId: string,
  prompt: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal
) {
  const fallback = localFinalAnswerFallback(prompt, messages);
  const config = getDeepSeekConfig();
  const needsLongAnswer = /调研|研究|对比|排名|前五|报告|分析|竞品|市场|新能源|NEV|top\s*\d+/i.test(prompt);

  return chatWithDeepSeek({
    taskId,
    stage: "final_answer",
    model,
    temperature: config.temperature,
    maxTokens: needsLongAnswer ? 2200 : 1400,
    fallback,
    signal,
    messages
  });
}

function localFinalAnswerFallback(prompt: string, messages: ChatMessage[]) {
  const context = messages.map((message) => message.content).join("\n\n").slice(0, 9000);
  const fileBlocks = Array.from(context.matchAll(/文件\s*\d*[：:]\s*([^\n]+)([\s\S]*?)(?=\n\n文件\s*\d*[：:]|\n\n\[工具观察|\n\n请输出|$)/g));
  const previewMatch = context.match(/正文预览[：:]\s*([\s\S]{80,2200})/);
  const unreadable = /无法抽取可信正文|没有抽取到可信正文|textReadable["']?\s*:\s*false|unreadable/.test(context);

  if (fileBlocks.length > 0 || previewMatch) {
    const preview = (previewMatch?.[1] ?? context)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 14);
    const facts = preview.filter((line) => /@|电话|手机|教育|经历|项目|公司|大学|本科|硕士|排名|实习|Agent|产品|Python|SQL/i.test(line));
    return [
      "已完成上传文件的首轮解析。",
      "",
      unreadable
        ? "注意：文件存在可读性风险，当前只能基于系统抽取/OCR得到的片段生成初步结论，建议人工复核原文。"
        : "文件正文已进入 Agent 上下文，以下结论基于已抽取文本生成。",
      "",
      "## 关键摘录",
      ...(facts.length > 0 ? facts : preview).slice(0, 8).map((line) => `- ${line}`),
      "",
      "## 初步结论",
      "- 已从上传文件中提取出可用于报告的主体文本，而不是仅返回文件名或占位说明。",
      "- 可继续要求 ManusXL 按简历评估、合同风险、论文摘要、表格洞察等方向做二次分析。",
      "- 若原文件是扫描版 PDF，OCR 结果可能存在错字，需要以原件为准复核关键姓名、日期、数字和联系方式。",
      "",
      "## 下一步建议",
      "- 指定你希望输出的结构，例如：候选人画像、能力标签、经历时间线、风险点、面试问题或改写后的中文简历。"
    ].join("\n");
  }

  if (/调研|研究|对比|排名|前五|竞品|市场|新能源|NEV|top\s*\d+/i.test(prompt)) {
    const sourceMatches = Array.from(
      context.matchAll(/资料\s*\d+[：:]\s*([^\n]+)\nURL[：:]\s*([^\n]+)(?:\n摘要[：:]\s*([^\n]+))?/g)
    ).slice(0, 8);

    return [
      `已完成任务「${taskIntentText(prompt).trim() || prompt}」的首轮调研，但当前最终回答由本地 fallback 生成。`,
      "",
      "## 结论",
      "- 已拿到可用于判断的网页资料线索，但大模型最终总结未返回可用内容，因此系统不会替你编造确定排名或数字。",
      "- 请检查 Settings 中 API Key、Base URL 和模型名后重跑；重跑后 Agent 会基于下列资料输出排名表、对比结论和建议。",
      "",
      "## 已获取资料",
      ...(sourceMatches.length > 0
        ? sourceMatches.map((match, index) => {
            const title = match[1]?.trim() || `资料 ${index + 1}`;
            const url = match[2]?.trim() || "无 URL";
            const snippet = match[3]?.trim();
            return `- ${title}：${url}${snippet ? `；摘要：${snippet.slice(0, 180)}` : ""}`;
          })
        : ["- 当前没有可引用资料；联网搜索可能失败或没有返回结果。"]),
      "",
      "## 下一步建议",
      "- 重新执行该任务，或把权威销量口径/链接作为补充资料上传。",
      "- 对新能源汽车排名类任务，建议明确口径：年度/月度、零售/批发、品牌/集团、国内/全球。"
    ].join("\n");
  }

  const observations = messages
    .filter((message) => message.content.includes("[工具观察"))
    .map((message) => message.content.replace(/\s+/g, " ").slice(0, 260));

  return [
    `已完成任务「${taskIntentText(prompt).trim() || prompt}」的首轮执行。`,
    "",
    "## 已完成",
    ...(observations.length > 0
      ? observations.slice(0, 6).map((item) => `- ${item}`)
      : ["- 已完成任务拆解、工具调用和交付物生成。"]),
    "",
    "## 说明",
    "- 当前回答由本地 fallback 生成，说明大模型调用未返回可用内容；请检查 Settings 中 API Key、Base URL 和模型名。",
    "- 为避免误导，fallback 不会伪造外部事实；需要真实调研时请确认模型连接正常后重跑。"
  ].join("\n");
}

async function generateRecoveryPlan(
  taskId: string,
  prompt: string,
  failedStep: string,
  toolResult: AgentToolResult,
  enabledTools: string[],
  model: string,
  signal?: AbortSignal
) {
  const fallback = JSON.stringify([
    "绕开失败工具，基于现有上下文整理可用结论",
    "使用已启用的其他工具补充关键依据",
    "标注无法验证部分并给出下一步建议"
  ]);
  const attempts = (toolResult.attempts ?? [])
    .map((attempt) => `${attempt.toolName}: ${attempt.ok ? "ok" : "failed"} - ${attempt.observation}`)
    .join("\n");
  const raw = await chatWithDeepSeek({
    taskId,
    stage: "replan",
    model,
    temperature: 0.25,
    maxTokens: 500,
    fallback,
    signal,
    messages: [
      {
        role: "system",
        content:
          "你是 Agent 任务恢复规划器。某个工具链已失败，请给出 1-3 个可继续执行的替代步骤。只返回 JSON 字符串数组，不要解释。"
      },
      {
        role: "user",
        content: [
          `用户任务：${prompt}`,
          `失败步骤：${failedStep}`,
          `工具失败摘要：${toolResult.observation}`,
          `工具尝试记录：\n${attempts || "无"}`,
          `当前可用工具：${enabledTools.join("、") || "无"}`
        ].join("\n\n")
      }
    ]
  });

  return parsePlan(raw, 3).filter((step) => step !== failedStep);
}

function isBudgetExceeded(taskId: string) {
  const budget = getDeepSeekConfig().taskBudgetUsd;
  if (!Number.isFinite(budget) || budget <= 0) return false;
  return getContextMetricsSummary(taskId).estimatedCostUsd >= budget;
}

function budgetMessage(taskId: string) {
  const summary = getContextMetricsSummary(taskId);
  const budget = getDeepSeekConfig().taskBudgetUsd;
  return `任务预算已达到上限：预估 $${summary.estimatedCostUsd.toFixed(4)} / $${budget.toFixed(2)}。已自动停止，避免继续消耗。`;
}

function getRunningTasks() {
  globalForRuntime.manusxlRunningTasks ??= new Set<string>();
  return globalForRuntime.manusxlRunningTasks;
}

function getTaskAbortControllers() {
  globalForRuntime.manusxlTaskAbortControllers ??= new Map<string, AbortController>();
  return globalForRuntime.manusxlTaskAbortControllers;
}

export function abortAgentTask(taskId: string) {
  const controller = getTaskAbortControllers().get(taskId);
  if (!controller || controller.signal.aborted) return false;
  controller.abort();
  return true;
}

function isGeneratedArtifact(value: unknown): value is GeneratedArtifact {
  const candidate = value as Partial<GeneratedArtifact>;
  return (
    !!candidate &&
    typeof candidate.name === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.mimeType === "string" &&
    typeof candidate.content === "string"
  );
}

function artifactsFromToolResults(toolResults: AgentToolResult[]) {
  return toolResults.flatMap((result) => {
    const generated = result.payload.generatedArtifacts;
    return Array.isArray(generated) ? generated.filter(isGeneratedArtifact) : [];
  });
}

export function isAgentTaskRunning(taskId: string) {
  return getRunningTasks().has(taskId);
}

export async function runAgentTask(taskId: string, options: { resumed?: boolean } = {}) {
  const runningTasks = getRunningTasks();
  if (runningTasks.has(taskId)) return;

  const task = getTask(taskId);
  if (!task) return;
  if (!["queued", "running"].includes(task.status)) return;

  runningTasks.add(taskId);
  const startedAt = Date.now();
  const timeoutMs = getTaskTimeoutMs();
  const timeoutController = new AbortController();
  getTaskAbortControllers().set(taskId, timeoutController);
  const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    if (options.resumed && task.events.length > 0) {
      addTaskEvent(taskId, {
        type: "message",
        stepIndex: task.events.length + 1,
        title: "任务恢复",
        content: "检测到任务曾处于排队或运行状态，已重新接管执行。"
      });
    }

    updateTaskStatus(taskId, "running");
    const memoryPath = await ensureTaskMemory(taskId, task.prompt, task.ownerId);
    let enabledTools = selectToolsForPrompt(task.prompt, task.ownerId);
    const initialToolMasking = estimateToolMaskingSavings(enabledTools);
    const planningRoute = routeModel("planning", task.prompt, task.ownerId);
    const executionRoute = routeModel("execution", task.prompt, task.ownerId);
    const finalRoute = routeModel("final_answer", task.prompt, task.ownerId);
    addTaskEvent(taskId, {
      type: "thinking",
      stepIndex: 0,
      title: "理解任务",
      content: "正在读取用户目标、约束和期望交付物。"
    });
    addTaskEvent(taskId, {
      type: "message",
      stepIndex: 1,
      title: "工具动态启用",
      content: [
        `本任务启用 ${enabledTools.length} 个工具：${enabledTools.join("、")}`,
        `相对全量 ${initialToolMasking.allToolCount} 个工具，已 mask ${initialToolMasking.maskedToolCount} 个；工具描述 token 预计下降 ${Math.round(initialToolMasking.tokenReductionPercent * 100)}%。`
      ].join("\n"),
      payload: { enabledTools, toolMasking: initialToolMasking }
    });
    addTaskEvent(taskId, {
      type: "message",
      stepIndex: 2,
      title: "模型路由",
      content: [
        `规划：${planningRoute.model}（${planningRoute.reason}）`,
        `执行：${executionRoute.model}（${executionRoute.reason}）`,
        `总结：${finalRoute.model}（${finalRoute.reason}）`
      ].join("\n"),
      payload: {
        modelRoutes: {
          planning: planningRoute,
          execution: executionRoute,
          finalAnswer: finalRoute
        }
      }
    });

    await wait(350);
    if (shouldStopTask(taskId, startedAt, timeoutMs, 3)) return;

    const initialMemory = await readTaskMemory(taskId, task.ownerId);
    const planningMessages = buildPlanningMessages({
      prompt: task.prompt,
      memory: initialMemory,
      enabledTools,
      ownerId: task.ownerId
    });
    const planningContext = createContextSnapshot({
      taskId,
      stage: "plan",
      messages: planningMessages,
      memoryPath
    });
    addTaskEvent(taskId, {
      type: "message",
      stepIndex: 3,
      title: "Context Engineering",
      content: formatContextSnapshot(planningContext),
      payload: { contextEngineering: planningContext }
    });

    const plan = await generatePlan(
      taskId,
      task.prompt,
      planningRoute.model,
      planningMessages,
      task.ownerId,
      task.uploadedFileIds ?? [],
      timeoutController.signal
    );
    if (shouldStopTask(taskId, startedAt, timeoutMs, 4)) return;

    const toolResults: AgentToolResult[] = [];
    await appendTaskMemory(taskId, {
      title: "Plan",
      content: plan.map((step, index) => `${index + 1}. ${step}`).join("\n")
    }, task.ownerId);

    addTaskEvent(taskId, {
      type: "plan",
      stepIndex: 4,
      title: "执行计划",
      content: plan.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      payload: { plan }
    });

    const planMetric = getLatestContextMetric(taskId, "plan");
    if (planMetric) {
      addTaskEvent(taskId, {
        type: "message",
        stepIndex: 5,
        title: "Context 指标",
        content: formatContextMetricForEvent(planMetric),
        payload: { contextMetric: planMetric }
      });
    }

    let recoveryInsertions = 0;
    const maxRecoveryInsertions = 2;

    for (let index = 0; index < plan.length; index += 1) {
      const step = plan[index];
      if (!step) continue;
      const stepIndex = index + 6;
      if (shouldStopTask(taskId, startedAt, timeoutMs, stepIndex)) return;
      if (stopForBudgetIfNeeded(taskId, stepIndex)) return;

      const missingTools = inferToolsForStep(step).filter((tool) => !enabledTools.includes(tool));
      if (missingTools.length > 0) {
        enabledTools = Array.from(new Set([...enabledTools, ...missingTools]));
        addTaskEvent(taskId, {
          type: "message",
          stepIndex,
          title: "工具补充启用",
          content: `当前步骤需要新的工具能力，已补充启用：${missingTools.join("、")}`,
          payload: {
            addedTools: missingTools,
            enabledTools
          }
        });
      }
      const toolName = pickTool(step, index, enabledTools);

      await wait(500);
      if (shouldStopTask(taskId, startedAt, timeoutMs, stepIndex)) return;

      addTaskEvent(taskId, {
        type: "thinking",
        stepIndex,
        title: step,
        content: `正在判断是否需要调用 ${toolName}。`
      });

      await wait(350);
      if (shouldStopTask(taskId, startedAt, timeoutMs, stepIndex)) return;

      addTaskEvent(taskId, {
        type: "tool_call",
        stepIndex,
        title: toolName,
        content: `调用工具处理：${step}`,
        payload: {
          toolName,
          arguments: {
            step,
            prompt: task.prompt,
            taskId,
            traceId: createId("trace")
          }
        }
      });

      const toolResult = await executeAgentToolWithFallback(
        toolName,
        {
          taskId,
          ownerId: task.ownerId,
          uploadedFileIds: task.uploadedFileIds ?? [],
          prompt: task.prompt,
          step,
          stepIndex: index,
          plan,
          emitProgress: (progress) =>
            addTaskEvent(taskId, {
              type: "message",
              stepIndex,
              title: progress.title,
              content: progress.content,
              payload: {
                toolName,
                progress: progress.payload
              }
            })
        },
        enabledTools
      );
      if (shouldStopTask(taskId, startedAt, timeoutMs, stepIndex)) return;

      toolResults.push(toolResult);
      await appendTaskMemory(taskId, {
        title: `Tool Observation ${index + 1}: ${toolName}`,
        content: toolResult.observation
      }, task.ownerId);

      addTaskEvent(taskId, {
        type: "tool_result",
        stepIndex,
        title: `${toolName} 结果`,
        content: toolResult.observation,
        payload: toolResult.payload
      });

      if (!toolResult.ok && recoveryInsertions < maxRecoveryInsertions) {
        recoveryInsertions += 1;
        const recoveryPlan = await generateRecoveryPlan(
          taskId,
          task.prompt,
          step,
          toolResult,
          enabledTools,
          executionRoute.model,
          timeoutController.signal
        );
        if (shouldStopTask(taskId, startedAt, timeoutMs, stepIndex)) return;

        if (recoveryPlan.length > 0) {
          plan.splice(index + 1, 0, ...recoveryPlan);
          await appendTaskMemory(taskId, {
            title: `Recovery Plan ${recoveryInsertions}`,
            content: [
              `失败步骤：${step}`,
              `失败摘要：${toolResult.observation}`,
              "替代步骤：",
              ...recoveryPlan.map((item, planIndex) => `${planIndex + 1}. ${item}`)
            ].join("\n")
          }, task.ownerId);
          addTaskEvent(taskId, {
            type: "plan",
            stepIndex: stepIndex + 1,
            title: "失败回流重规划",
            content: recoveryPlan.map((item, planIndex) => `${planIndex + 1}. ${item}`).join("\n"),
            payload: {
              recovery: {
                failedStep: step,
                insertedAfterIndex: index,
                plan: recoveryPlan,
                attempts: toolResult.attempts ?? []
              }
            }
          });
        }
      }
    }

    if (shouldStopTask(taskId, startedAt, timeoutMs, plan.length + 6)) return;

    addTaskEvent(taskId, {
      type: "message",
      stepIndex: plan.length + 6,
      title: "生成最终回答",
      content: "正在汇总执行过程，生成可交付结论。"
    });

    const finalMemory = await readTaskMemory(taskId, task.ownerId);
    const finalMessages = buildFinalMessages({
      prompt: task.prompt,
      plan,
      toolResults,
      memory: finalMemory,
      enabledTools,
      ownerId: task.ownerId
    });
    const finalContext = createContextSnapshot({
      taskId,
      stage: "final_answer",
      messages: finalMessages,
      memoryPath
    });
    addTaskEvent(taskId, {
      type: "message",
      stepIndex: plan.length + 7,
      title: "Context Engineering",
      content: formatContextSnapshot(finalContext),
      payload: { contextEngineering: finalContext }
    });

    const finalAnswer = await generateFinalAnswer(
      taskId,
      task.prompt,
      finalRoute.model,
      finalMessages,
      timeoutController.signal
    );
    if (shouldStopTask(taskId, startedAt, timeoutMs, plan.length + 8)) return;

    setFinalAnswer(taskId, finalAnswer);
    await appendTaskMemory(taskId, {
      title: "Final Answer",
      content: finalAnswer
    }, task.ownerId);

    const finalMetric = getLatestContextMetric(taskId, "final_answer");
    if (finalMetric) {
      addTaskEvent(taskId, {
        type: "message",
        stepIndex: plan.length + 8,
        title: "Context 指标",
        content: formatContextMetricForEvent(finalMetric),
        payload: { contextMetric: finalMetric }
      });
    }
    if (shouldStopTask(taskId, startedAt, timeoutMs, plan.length + 9)) return;

    const generatedArtifacts = [
      ...generateDeliverables(task.prompt, plan, finalAnswer),
      ...artifactsFromToolResults(toolResults),
      {
        name: "agent-trace.json",
        type: "json" as const,
        mimeType: "application/json; charset=utf-8",
        content: JSON.stringify(getTask(taskId), null, 2)
      }
    ];

    generatedArtifacts.forEach((generated, index) => {
      const artifact = addArtifact(taskId, generated);
      if (!artifact) return;
      addTaskEvent(taskId, {
        type: "artifact",
        stepIndex: plan.length + 9 + index,
        title: artifact.name,
        content: `已生成 ${artifact.type.toUpperCase()} 交付物。`,
        payload: { artifact }
      });
    });

    if (shouldStopTask(taskId, startedAt, timeoutMs, plan.length + 9 + generatedArtifacts.length)) {
      return;
    }

    const tmpCleanup = await archiveTmpIfNeeded(taskId, task.ownerId);
    if (shouldStopTask(taskId, startedAt, timeoutMs, plan.length + 9 + generatedArtifacts.length)) {
      return;
    }

    addTaskEvent(taskId, {
      type: "message",
      stepIndex: plan.length + 9 + generatedArtifacts.length,
      title: "Workspace 清理",
      content:
        tmpCleanup.action === "archived"
          ? `tmp 中的 ${tmpCleanup.fileCount} 个中间文件已归档，当前 tmp 已清空。`
          : tmpCleanup.action === "kept"
            ? `tmp 中的 ${tmpCleanup.fileCount} 个中间文件按 ${tmpCleanup.retentionDays} 天保留策略继续保留。`
            : "tmp 目录没有需要清理的中间文件。",
      payload: { tmpCleanup }
    });

    updateTaskStatus(taskId, "completed");
    addTaskEvent(taskId, {
      type: "finished",
      stepIndex: plan.length + 10 + generatedArtifacts.length,
      title: "任务完成",
      content: finalAnswer
    });
  } catch (error) {
    if (timeoutController.signal.aborted || isTaskTimedOut(startedAt, timeoutMs)) {
      markTaskTimeout(taskId, getTask(taskId)?.events.length ?? 0, timeoutMs);
      return;
    }

    const currentStatus = getTask(taskId)?.status;
    if (currentStatus === "cancelled" || currentStatus === "timeout") return;

    const message = error instanceof Error ? error.message : "Unknown agent error";
    updateTaskStatus(taskId, "failed", message);
    addTaskEvent(taskId, {
      type: "failed",
      stepIndex: getTask(taskId)?.events.length ?? 0,
      title: "任务失败",
      content: message
    });
  } finally {
    clearTimeout(timeoutTimer);
    getTaskAbortControllers().delete(taskId);
    await cleanupSandboxForWorkspace(taskWorkspacePaths(taskId, task.ownerId).root);
    runningTasks.delete(taskId);
  }
}
