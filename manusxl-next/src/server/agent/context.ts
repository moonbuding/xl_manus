import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import type { ChatMessage } from "@/server/llm/deepseek";
import { describeTools, type AgentToolName, type AgentToolResult } from "@/server/agent/tools";
import { enabledMcpTools, listEnabledMcpServers } from "@/server/mcp/mcp-registry";
import { selectSkillsForPrompt } from "@/server/skills/skill-registry";
import { ensureTaskWorkspace, taskWorkspacePaths } from "@/server/workspace/task-workspace";

export const STABLE_SYSTEM_PREFIX = [
  "你是 ManusXL，一个单 Agent 工作台的执行内核。",
  "上下文策略：system prompt 的稳定前缀在任务期间保持不变；历史信息只追加不重排；工具与文件摘要放在稳定前缀之后。",
  "运行原则：先理解任务，再规划，再按步骤调用工具，最后汇总为可下载交付物。",
  "记忆原则：长期任务状态写入任务 workspace 的 memory 文件；临时执行痕迹写入 tmp；最终产物写入 artifacts。",
  "输出要求：保持中文、结构化、可交付，优先复用已有上下文和文件摘要。"
].join("\n");

interface BuildPlanningMessagesInput {
  prompt: string;
  memory: string;
  enabledTools: AgentToolName[];
  ownerId?: string;
}

interface BuildFinalMessagesInput {
  prompt: string;
  plan: string[];
  toolResults: AgentToolResult[];
  memory: string;
  enabledTools: AgentToolName[];
  ownerId?: string;
}

interface ContextSnapshotInput {
  taskId: string;
  stage: string;
  messages: ChatMessage[];
  memoryPath: string;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function systemPrompt(prompt: string, enabledTools: AgentToolName[], ownerId?: string) {
  const tools = describeTools(enabledTools)
    .map((tool) => `- ${tool.name} [${tool.namespace}]: ${tool.description}`)
    .join("\n");
  const skills = selectSkillsForPrompt(prompt, ownerId)
    .map(
      (skill) =>
        `- ${skill.name}: ${skill.description}${skill.toolsRequired.length > 0 ? `；需要工具：${skill.toolsRequired.join("、")}` : ""}`
    )
    .join("\n");
  const mcpServers = listEnabledMcpServers(ownerId)
    .map((server) => `- ${server.name} [${server.type}]: ${enabledMcpTools(server).join("、") || "无启用工具"}`)
    .join("\n");

  return `${STABLE_SYSTEM_PREFIX}\n\n可用工具（固定尾部）：\n${tools}${
    skills ? `\n\n按需启用 Skills：\n${skills}` : ""
  }${mcpServers ? `\n\n已启用 MCP Servers：\n${mcpServers}` : ""}`;
}

function withMemory(prompt: string, memory: string) {
  const trimmedMemory = memory.trim();
  if (!trimmedMemory) return prompt;
  return `${prompt}\n\n[持久 memory 摘要]\n${trimmedMemory.slice(-5000)}`;
}

export async function ensureTaskMemory(taskId: string, prompt: string, ownerId?: string) {
  const paths = await ensureTaskWorkspace(taskId, ownerId);

  if (!existsSync(paths.memoryFile)) {
    await writeFile(
      paths.memoryFile,
      [
        "# Agent Memory",
        "",
        `Task ID: ${taskId}`,
        `Created: ${new Date().toISOString()}`,
        "",
        "## Objective",
        prompt,
        ""
      ].join("\n")
    );
  }

  return paths.memoryFile;
}

export async function readTaskMemory(taskId: string, ownerId?: string) {
  const { memoryFile } = taskWorkspacePaths(taskId, ownerId);
  if (!existsSync(memoryFile)) return "";
  return readFile(memoryFile, "utf8");
}

export async function appendTaskMemory(
  taskId: string,
  entry: {
    title: string;
    content: string;
  },
  ownerId?: string
) {
  const memoryPath = await ensureTaskMemory(taskId, "", ownerId);
  await appendFile(
    memoryPath,
    [
      "",
      `## ${entry.title}`,
      `Time: ${new Date().toISOString()}`,
      "",
      entry.content.trim(),
      ""
    ].join("\n")
  );
  return memoryPath;
}

export function buildPlanningMessages(input: BuildPlanningMessagesInput): ChatMessage[] {
  return [
    {
      role: "system",
      content: systemPrompt(input.prompt, input.enabledTools, input.ownerId)
    },
    {
      role: "user",
      content: withMemory(
        [
          "当前角色：任务规划器。",
          "请把用户任务拆成 3-6 个可执行步骤，只返回 JSON 字符串数组，不要返回 Markdown。",
          "",
          `用户任务：${input.prompt}`
        ].join("\n"),
        input.memory
      )
    }
  ];
}

export function buildFinalMessages(input: BuildFinalMessagesInput): ChatMessage[] {
  const planText = input.plan.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const toolObservationMessages: ChatMessage[] = input.toolResults.map((result, index) => ({
    role: "user",
    content: `[工具观察 ${index + 1}]\n工具：${result.toolName}\n结果：${result.observation}`
  }));

  return [
    {
      role: "system",
      content: systemPrompt(input.prompt, input.enabledTools, input.ownerId)
    },
    {
      role: "user",
      content: withMemory(
        [
          "当前角色：执行总结器。",
          "请基于任务、计划、持久 memory 和工具观察，给出简洁、可交付的中文总结。",
          "",
          `用户任务：${input.prompt}`
        ].join("\n"),
        input.memory
      )
    },
    {
      role: "assistant",
      content: `执行计划已确定：\n${planText}`
    },
    ...toolObservationMessages,
    {
      role: "user",
      content: "请输出最终回答，包含已完成、关键结论、建议下一步。"
    }
  ];
}

export function createContextSnapshot(input: ContextSnapshotInput) {
  const systemMessage = input.messages.find((message) => message.role === "system");
  const systemPromptValue = systemMessage?.content ?? "";
  const toolTailIndex = systemPromptValue.indexOf("可用工具（固定尾部）：");
  const skillTailIndex = systemPromptValue.indexOf("按需启用 Skills：");
  const mcpTailIndex = systemPromptValue.indexOf("已启用 MCP Servers：");
  const stablePrefix =
    toolTailIndex >= 0 ? systemPromptValue.slice(0, toolTailIndex).trim() : systemPromptValue;

  return {
    taskId: input.taskId,
    stage: input.stage,
    stablePrefixHash: hashText(stablePrefix),
    systemPromptHash: hashText(systemPromptValue),
    messageCount: input.messages.length,
    appendOnlyHistory: true,
    toolsAtTail: toolTailIndex > 0,
    memoryPath: input.memoryPath,
    activeToolCount: systemPromptValue
      .slice(
        toolTailIndex >= 0 ? toolTailIndex : 0,
        skillTailIndex >= 0 ? skillTailIndex : systemPromptValue.length
      )
      .split("\n- ").length - 1,
    activeSkillCount:
      skillTailIndex >= 0
        ? systemPromptValue
            .slice(skillTailIndex, mcpTailIndex >= 0 ? mcpTailIndex : systemPromptValue.length)
            .split("\n- ").length - 1
        : 0,
    activeMcpServerCount:
      mcpTailIndex >= 0
        ? systemPromptValue.slice(mcpTailIndex).split("\n- ").length - 1
        : 0,
    stablePrefixTokensEstimate: Math.ceil(stablePrefix.length / 3),
    createdAt: new Date().toISOString()
  };
}

export function formatContextSnapshot(snapshot: ReturnType<typeof createContextSnapshot>) {
  return [
    `System prefix hash: ${snapshot.stablePrefixHash}`,
    `System prompt hash: ${snapshot.systemPromptHash}`,
    `消息数: ${snapshot.messageCount}`,
    `Append-only: ${snapshot.appendOnlyHistory ? "yes" : "no"}`,
    `工具描述尾部固定: ${snapshot.toolsAtTail ? "yes" : "no"}`,
    `启用工具数: ${snapshot.activeToolCount}`,
    `启用 Skills: ${snapshot.activeSkillCount}`,
    `启用 MCP Servers: ${snapshot.activeMcpServerCount}`,
    `Memory: ${snapshot.memoryPath}`
  ].join("\n");
}
