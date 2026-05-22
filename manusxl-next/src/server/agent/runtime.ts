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

function ensureFileReadingStep(prompt: string, plan: string[]) {
  if (!prompt.includes("[上传文件摘要]")) return plan;
  if (plan.some((step) => /上传文件|文件摘要|附件|读取上传|读取附件/i.test(step))) {
    return plan;
  }

  return ["读取上传文件摘要并提取可用信息", ...plan].slice(0, 6);
}

function ensureMcpStep(prompt: string, plan: string[]) {
  if (!/mcp|外部工具|第三方工具|github|slack|notion|filesystem/i.test(prompt)) return plan;
  if (plan.some((step) => /mcp|外部工具|第三方工具|github|slack|notion|filesystem/i.test(step))) {
    return plan;
  }

  return ["调用已启用的 MCP 工具获取外部上下文", ...plan].slice(0, 6);
}

function ensureBatchFileOpsStep(prompt: string, plan: string[]) {
  if (!/批量|重命名|分类|移动|整理文件|rename|classify/i.test(prompt)) return plan;
  if (plan.some((step) => /批量|重命名|分类|移动|整理文件|batch_file_ops|rename|classify/i.test(step))) {
    return plan;
  }

  return ["生成上传文件的批量重命名和分类 dry-run 清单", ...plan].slice(0, 6);
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

  return ensureSkillRunnerStep(
    prompt,
    ownerId,
    ensureMapStep(
      prompt,
      ensureMcpStep(
        prompt,
        ensureBatchFileOpsStep(prompt, ensureFileReadingStep(prompt, parsePlan(raw, config.maxSteps)))
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
  const fallback = `已完成任务「${prompt}」的首轮 Agent 执行。当前版本已经跑通任务拆解、步骤展示、工具调用事件和交付物生成区域；下一步可以接入真实搜索、浏览器和文件沙盒能力。`;
  const config = getDeepSeekConfig();

  return chatWithDeepSeek({
    taskId,
    stage: "final_answer",
    model,
    temperature: config.temperature,
    maxTokens: 1200,
    fallback,
    signal,
    messages
  });
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
    const planningRoute = routeModel("planning", task.prompt);
    const executionRoute = routeModel("execution", task.prompt);
    const finalRoute = routeModel("final_answer", task.prompt);
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
      content: `本任务启用 ${enabledTools.length} 个工具：${enabledTools.join("、")}`,
      payload: { enabledTools }
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
          prompt: task.prompt,
          step,
          stepIndex: index,
          plan
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
    await cleanupSandboxForWorkspace(taskWorkspacePaths(taskId, task.ownerId).root);
    runningTasks.delete(taskId);
  }
}
