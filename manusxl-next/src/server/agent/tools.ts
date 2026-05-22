import { execFile } from "node:child_process";
import { appendFile, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { makeZip } from "@/server/artifacts/generators";
import { listUploadedFileRecords, type UploadedFileRecord } from "@/server/files/readers";
import { getOcrStatus } from "@/server/ocr/status";
import {
  runLocalBrowserAction,
  screenshotLocalBrowserTab,
  snapshotLocalBrowserTab
} from "@/server/local-browser/cdp";
import {
  createMyComputerSystemOperation,
  getMyComputerStatus,
  planMyComputerFileOperation
} from "@/server/my-computer/my-computer";
import { runSandboxedCommand } from "@/server/sandbox/docker-sandbox";
import {
  hasExecutableSkillForPrompt,
  selectExecutableSkillsForPrompt
} from "@/server/skills/skill-registry";
import { callMcpServerTool, enabledMcpTools, listEnabledMcpServers } from "@/server/mcp/mcp-registry";
import { ensureTaskWorkspace } from "@/server/workspace/task-workspace";

const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
const DEFAULT_TOOL_MAX_BUFFER_BYTES = 1024 * 1024;
const execFileAsync = promisify(execFile);

interface ChildProcessExecutionError extends Error {
  code?: number | string;
  killed?: boolean;
  signal?: NodeJS.Signals;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function configuredPositiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getToolExecutionLimits() {
  return {
    timeoutMs: configuredPositiveNumber("MANUSXL_TOOL_TIMEOUT_MS", DEFAULT_TOOL_TIMEOUT_MS),
    maxBufferBytes: configuredPositiveNumber(
      "MANUSXL_TOOL_MAX_BUFFER_BYTES",
      DEFAULT_TOOL_MAX_BUFFER_BYTES
    )
  };
}

function textFromProcessField(value: unknown) {
  if (Buffer.isBuffer(value)) return value.toString("utf-8");
  return typeof value === "string" ? value : "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  return `${(kib / 1024).toFixed(1)} MB`;
}

function summarizeProcessError(error: unknown, toolLabel: string) {
  const processError = error as ChildProcessExecutionError;
  const raw = [
    processError.message,
    textFromProcessField(processError.stderr),
    textFromProcessField(processError.stdout)
  ]
    .filter(Boolean)
    .join("\n");
  const lower = raw.toLowerCase();
  const limits = getToolExecutionLimits();

  if (
    /timed out|timeout|etimedout/.test(lower) ||
    (processError.killed && processError.signal !== "SIGKILL")
  ) {
    return {
      kind: "timeout",
      message: `${toolLabel} 执行超时：已超过 ${Math.ceil(limits.timeoutMs / 1000)} 秒运行上限，系统已停止该工具。可以缩小输入范围后重试。`
    };
  }

  if (
    processError.code === 137 ||
    processError.code === "137" ||
    processError.signal === "SIGKILL" ||
    /out of memory|cannot allocate memory|memoryerror|oom|allocation failed|bad_alloc|killed/.test(
      lower
    )
  ) {
    return {
      kind: "oom",
      message: `${toolLabel} 执行失败：疑似内存不足，系统已停止该工具，避免影响其他任务。可以减少数据量或拆分任务后重试。`
    };
  }

  if (/maxbuffer|stdout maxbuffer|stderr maxbuffer/.test(lower)) {
    return {
      kind: "output_limit",
      message: `${toolLabel} 输出过大：已超过 ${formatBytes(limits.maxBufferBytes)} 安全上限，系统已截断输出。可以要求任务输出摘要或分批处理。`
    };
  }

  if (/workspace .*磁盘配额|disk quota|no space left|enospc|disk_limit/.test(lower)) {
    return {
      kind: "disk_limit",
      message: `${toolLabel} 执行失败：任务工作区已超过磁盘配额，系统已停止继续写入。可以删除无关临时文件或拆分任务后重试。`
    };
  }

  const detail = raw.split("\n").find(Boolean)?.slice(0, 240) || "unknown error";
  return {
    kind: "execution_error",
    message: `${toolLabel} 执行失败：${detail}。`
  };
}

function processErrorPayload(error: unknown) {
  const processError = error as ChildProcessExecutionError;
  return {
    error: processError.message ?? String(error),
    code: processError.code,
    signal: processError.signal,
    killed: processError.killed,
    stdout: textFromProcessField(processError.stdout).slice(0, 3000),
    stderr: textFromProcessField(processError.stderr).slice(0, 3000)
  };
}

export type AgentToolName =
  | "task_planner"
  | "web_research"
  | "web_fetch"
  | "local_browser"
  | "my_computer"
  | "file_reader"
  | "file_workspace"
  | "batch_file_ops"
  | "batch_image_process"
  | "image_ocr"
  | "skill_runner"
  | "python_execute"
  | "shell_execute"
  | "mcp_call"
  | "data_analysis"
  | "map_planner"
  | "chart_generator"
  | "artifact_writer";

export interface AgentToolInput {
  taskId: string;
  ownerId?: string;
  uploadedFileIds?: string[];
  prompt: string;
  step: string;
  stepIndex: number;
  plan: string[];
  failureOverrides?: Partial<Record<AgentToolName, string>>;
  emitProgress?: (progress: AgentToolProgress) => void | Promise<void>;
}

export interface AgentToolProgress {
  title: string;
  content: string;
  payload?: Record<string, unknown>;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface AgentToolResult {
  toolName: AgentToolName;
  ok: boolean;
  observation: string;
  payload: Record<string, unknown>;
  attempts?: Array<{
    toolName: AgentToolName;
    ok: boolean;
    observation: string;
  }>;
  usedFallback?: boolean;
}

export interface AgentToolMetadata {
  name: AgentToolName;
  namespace: "core" | "web" | "file" | "code" | "data" | "artifact";
  description: string;
  fallbackTools: AgentToolName[];
}

export const TOOL_METADATA: AgentToolMetadata[] = [
  {
    name: "task_planner",
    namespace: "core",
    description: "澄清目标、拆解任务、确认交付物。",
    fallbackTools: []
  },
  {
    name: "web_research",
    namespace: "web",
    description: "进行真实网页搜索并返回候选资料。",
    fallbackTools: ["data_analysis", "task_planner"]
  },
  {
    name: "web_fetch",
    namespace: "web",
    description: "读取用户提供的 URL 页面内容。",
    fallbackTools: ["web_research", "data_analysis"]
  },
  {
    name: "local_browser",
    namespace: "web",
    description: "读取用户本地 Chrome 当前标签页的已登录页面快照，支持截图和基础导航，受域名 allowlist 限制。",
    fallbackTools: ["web_fetch", "web_research", "data_analysis"]
  },
  {
    name: "my_computer",
    namespace: "file",
    description: "调度 My Computer 本机能力：扫描允许目录、生成文件分类/查重/重命名 dry-run，以及创建应用/剪贴板/键鼠授权请求。",
    fallbackTools: ["batch_file_ops", "file_workspace", "task_planner"]
  },
  {
    name: "file_reader",
    namespace: "file",
    description: "读取用户上传文件摘要，支持 PDF、DOCX、XLSX、CSV 等。",
    fallbackTools: ["file_workspace", "data_analysis"]
  },
  {
    name: "file_workspace",
    namespace: "file",
    description: "创建任务工作区并写入任务文件。",
    fallbackTools: ["task_planner"]
  },
  {
    name: "batch_file_ops",
    namespace: "file",
    description: "为批量重命名、分类、移动和图片处理生成安全 dry-run 操作清单。",
    fallbackTools: ["file_reader", "file_workspace", "data_analysis"]
  },
  {
    name: "batch_image_process",
    namespace: "file",
    description: "对上传图片执行批量压缩、缩放、旋转和格式转换，并输出处理包。",
    fallbackTools: ["batch_file_ops", "file_reader", "file_workspace"]
  },
  {
    name: "image_ocr",
    namespace: "file",
    description: "对上传图片执行 OCR 文字识别，并输出 JSON/CSV/Markdown 报告。",
    fallbackTools: ["file_reader", "batch_image_process", "artifact_writer"]
  },
  {
    name: "skill_runner",
    namespace: "core",
    description: "在任务沙盒中执行用户上传 Skill 包内的 Python 脚本。",
    fallbackTools: ["python_execute", "data_analysis", "artifact_writer"]
  },
  {
    name: "python_execute",
    namespace: "code",
    description: "在任务工作区执行受控 Python 分析脚本。",
    fallbackTools: ["shell_execute", "data_analysis"]
  },
  {
    name: "shell_execute",
    namespace: "code",
    description: "在任务工作区执行受控 Shell 检查命令。",
    fallbackTools: ["file_workspace", "data_analysis"]
  },
  {
    name: "mcp_call",
    namespace: "core",
    description: "调用当前用户已启用的 MCP Server 工具。",
    fallbackTools: ["data_analysis", "task_planner"]
  },
  {
    name: "data_analysis",
    namespace: "data",
    description: "整理维度、指标与结构化分析数据。",
    fallbackTools: ["task_planner"]
  },
  {
    name: "map_planner",
    namespace: "data",
    description: "为地图、路线、行程和地点调研生成可下载的地图式 HTML/JSON 交付物。",
    fallbackTools: ["web_research", "data_analysis", "artifact_writer"]
  },
  {
    name: "chart_generator",
    namespace: "artifact",
    description: "生成 line/bar/pie/scatter/heatmap 图表规格，用于 Dashboard 交付物。",
    fallbackTools: ["data_analysis", "artifact_writer"]
  },
  {
    name: "artifact_writer",
    namespace: "artifact",
    description: "准备 Markdown、CSV、XLSX、PPTX、PDF、HTML、ZIP 交付物上下文。",
    fallbackTools: ["file_workspace", "data_analysis"]
  }
];

const toolMetadataByName = new Map(TOOL_METADATA.map((tool) => [tool.name, tool]));

function uniqueTools(tools: AgentToolName[]) {
  return Array.from(new Set(tools));
}

function taskIntentText(prompt: string) {
  const marker = "[上传文件摘要]";
  const markerIndex = prompt.indexOf(marker);
  return markerIndex >= 0 ? prompt.slice(0, markerIndex) : prompt;
}

export function selectToolsForPrompt(prompt: string, ownerId?: string): AgentToolName[] {
  const intent = taskIntentText(prompt);
  const lower = intent.toLowerCase();
  const selected: AgentToolName[] = ["task_planner", "data_analysis", "artifact_writer"];

  if (/http|网页|搜索|调研|竞品|市场|news|web|research|browser/.test(lower)) {
    selected.push("web_research", "web_fetch");
  }
  if (/本地浏览器|已登录态|登录态|paywall|captcha|cdp|chrome/.test(lower)) {
    selected.push("local_browser");
  }
  if (/my computer|本机|本地文件|桌面端|downloads|documents|下载目录|剪贴板|启动应用|打开应用|键鼠|鼠标|键盘/.test(lower)) {
    selected.push("my_computer");
  }
  if (/mcp|github|slack|notion|filesystem|外部工具|第三方工具/.test(lower)) {
    selected.push("mcp_call");
  }
  if (prompt.includes("[上传文件摘要]") || /上传|文件|pdf|docx|xlsx|csv|excel|word|图片|image|ocr/.test(lower)) {
    selected.push("file_reader", "file_workspace");
  }
  if (/批量|重命名|分类|移动|查重|压缩|缩放|图片|image|ocr|rename|classify/.test(lower)) {
    selected.push("batch_file_ops", "file_reader", "file_workspace");
  }
  if (/(图片|image|照片|photo).*(压缩|缩放|旋转|格式转换|转成|convert|resize|compress)|(压缩|缩放|旋转|格式转换|转成|convert|resize|compress).*(图片|image|照片|photo)/.test(lower)) {
    selected.push("batch_image_process", "file_reader", "file_workspace");
  }
  if (/ocr|文字识别|识别.*(图片|照片|发票|名片|扫描|文字)|提取.*(图片|照片).*文字|发票|名片/i.test(intent)) {
    selected.push("image_ocr", "file_reader", "file_workspace");
  }
  if (/skill|技能|工作流|自定义/.test(lower) || hasExecutableSkillForPrompt(prompt, ownerId)) {
    selected.push("skill_runner", "file_workspace");
  }
  if (/python|脚本|代码|计算|统计|shell|bash|命令|终端|目录|workspace/.test(lower)) {
    selected.push("python_execute", "shell_execute", "file_workspace");
  }
  if (/报告|总结|网页|dashboard|看板|ppt|pdf|excel|交付|图表|chart/.test(lower)) {
    selected.push("artifact_writer", "file_workspace", "data_analysis");
  }
  if (/图表|chart|dashboard|看板|趋势|柱状|折线|饼图|散点|热力/.test(lower)) {
    selected.push("chart_generator", "artifact_writer", "data_analysis");
  }
  if (/地图|路线|行程|旅行|旅游|门店|地址|附近|周边|导航|map|route|itinerary|location/.test(lower)) {
    selected.push("map_planner", "web_research", "artifact_writer", "data_analysis");
  }

  return uniqueTools(selected);
}

export function inferToolsForStep(step: string): AgentToolName[] {
  const lower = step.toLowerCase();
  const candidates: AgentToolName[] = [];

  const explicitToolNames = TOOL_METADATA.map((tool) => tool.name).filter((name) =>
    lower.includes(name)
  );
  if (explicitToolNames.length > 0) {
    candidates.push(...(explicitToolNames as AgentToolName[]));
  }

  if (/python|脚本|代码|计算|统计|notebook/.test(lower)) candidates.push("python_execute");
  if (/shell|bash|命令|终端|目录|workspace|文件检查/.test(lower)) candidates.push("shell_execute");
  if (/mcp|github|slack|notion|filesystem|外部工具|第三方工具/.test(lower)) {
    candidates.push("mcp_call");
  }
  if (/https?:\/\//i.test(step)) candidates.push("web_fetch");
  if (/网页|搜索|调研|竞品|市场|news|web|research/.test(lower)) candidates.push("web_research");
  if (/本地浏览器|已登录态|登录态|paywall|captcha|cdp|chrome/.test(lower)) candidates.push("local_browser");
  if (/my computer|本机|本地文件|桌面端|downloads|documents|下载目录|剪贴板|启动应用|打开应用|键鼠|鼠标|键盘/.test(lower)) {
    candidates.push("my_computer");
  }
  if (/上传文件|文件摘要|附件|读取.*(文件|pdf|docx|xlsx|csv|excel|word)|解析.*(文件|pdf|docx|xlsx|csv|excel|word)/.test(lower)) {
    candidates.push("file_reader");
  }
  if (/ocr|文字识别|识别.*(图片|照片|发票|名片|扫描|文字)|提取.*(图片|照片).*文字|发票|名片/.test(lower)) {
    candidates.push("image_ocr");
  }
  if (/(图片|image|照片|photo).*(压缩|缩放|旋转|格式转换|转成|convert|resize|compress)|(压缩|缩放|旋转|格式转换|转成|convert|resize|compress).*(图片|image|照片|photo)/.test(lower)) {
    candidates.push("batch_image_process");
  }
  if (/批量|重命名|分类|移动|查重|图片|image|ocr|rename|classify/.test(lower)) {
    candidates.push("batch_file_ops");
  }
  if (/skill|技能|工作流|自定义|执行.*脚本/.test(lower)) {
    candidates.push("skill_runner");
  }
  if (/图表|chart|dashboard|看板|趋势|柱状|折线|饼图|散点|热力/.test(lower)) {
    candidates.push("chart_generator");
  }
  if (/地图|路线|行程|旅行|旅游|门店|地址|附近|周边|导航|map|route|itinerary|location/.test(lower)) {
    candidates.push("map_planner");
  }
  if (
    /(生成|输出|创建|制作|导出|准备|打包).*(报告|总结|网页|html|ppt|pptx|pdf|excel|xlsx|csv|zip|dashboard|看板|图表|交付物)|报告|交付物/.test(
      lower
    )
  ) {
    candidates.push("artifact_writer");
  }
  if (/分析|对比|计算|指标|数据|整理/.test(lower)) candidates.push("data_analysis");
  if (/workspace|工作区|目录|文件结构|写入|归档|manifest/.test(lower)) candidates.push("file_workspace");
  return uniqueTools(candidates);
}

export function describeTools(tools: AgentToolName[]) {
  const enabled = new Set(tools);
  return TOOL_METADATA.filter((tool) => enabled.has(tool.name));
}

function estimateToolDescriptionTokens(tools: AgentToolMetadata[]) {
  const text = tools
    .map((tool) => `${tool.name} [${tool.namespace}]: ${tool.description}`)
    .join("\n");
  return Math.max(1, Math.ceil(text.length / 3));
}

export function estimateToolMaskingSavings(tools: AgentToolName[]) {
  const enabledTools = describeTools(tools);
  const fullToolTokensEstimate = estimateToolDescriptionTokens(TOOL_METADATA);
  const enabledToolTokensEstimate = estimateToolDescriptionTokens(enabledTools);
  const savedToolTokensEstimate = Math.max(0, fullToolTokensEstimate - enabledToolTokensEstimate);
  const tokenReductionPercent =
    fullToolTokensEstimate > 0 ? savedToolTokensEstimate / fullToolTokensEstimate : 0;

  return {
    allToolCount: TOOL_METADATA.length,
    enabledToolCount: enabledTools.length,
    maskedToolCount: Math.max(0, TOOL_METADATA.length - enabledTools.length),
    fullToolTokensEstimate,
    enabledToolTokensEstimate,
    savedToolTokensEstimate,
    tokenReductionPercent: Number(tokenReductionPercent.toFixed(4))
  };
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeDuckDuckGoUrl(value: string) {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://duckduckgo.com${value}`);
    const encoded = url.searchParams.get("uddg");
    return encoded ? decodeURIComponent(encoded) : value;
  } catch {
    return value;
  }
}

async function fetchText(url: string, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ManusXL/0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const html = await fetchText(
    `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    12000
  );
  const results: SearchResult[] = [];
  const blockRegex = /<div class="result[\s\S]*?<\/div>\s*<\/div>/gi;
  const blocks = html.match(blockRegex) ?? [];

  for (const block of blocks.slice(0, 5)) {
    const link = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const snippet = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    results.push({
      title: stripHtml(link[2]),
      url: decodeDuckDuckGoUrl(link[1]),
      snippet: snippet ? stripHtml(snippet[1]) : ""
    });
  }

  return results;
}

async function searchInstantAnswer(query: string): Promise<SearchResult[]> {
  const response = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "ManusXL/0.1"
      }
    }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };
  const results: SearchResult[] = [];

  if (data.AbstractText || data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL || "https://duckduckgo.com",
      snippet: data.AbstractText || ""
    });
  }

  for (const topic of data.RelatedTopics ?? []) {
    if (!topic.Text || !topic.FirstURL) continue;
    results.push({
      title: topic.Text.split(" - ")[0] || query,
      url: topic.FirstURL,
      snippet: topic.Text
    });
  }

  return results.slice(0, 5);
}

async function webSearch(query: string) {
  try {
    const results = await searchDuckDuckGo(query);
    if (results.length > 0) return results;
  } catch {
    // Try the lightweight JSON endpoint below.
  }

  return searchInstantAnswer(query);
}

function extractUrl(value: string) {
  return value.match(/https?:\/\/[^\s)]+/i)?.[0];
}

async function runTaskPlanner(input: AgentToolInput): Promise<AgentToolResult> {
  return {
    toolName: "task_planner",
    ok: true,
    observation: `已确认任务目标、交付物和执行顺序。本任务共有 ${input.plan.length} 个计划步骤，当前步骤是第 ${input.stepIndex + 1} 步。`,
    payload: {
      objective: input.prompt,
      currentStep: input.step,
      totalSteps: input.plan.length
    }
  };
}

async function runWebResearch(input: AgentToolInput): Promise<AgentToolResult> {
  const query = `${input.step} ${input.prompt}`.slice(0, 180);
  try {
    const results = await webSearch(query);
    if (results.length === 0) {
      return {
        toolName: "web_research",
        ok: true,
        observation: "已尝试联网搜索，但没有返回可用结果；后续步骤将基于模型知识和已有上下文继续。",
        payload: { query, results: [] }
      };
    }

    return {
      toolName: "web_research",
      ok: true,
      observation: `已完成真实网页搜索，返回 ${results.length} 条候选资料：${results
        .map((item, index) => `${index + 1}. ${item.title}`)
        .join("；")}`,
      payload: { query, results }
    };
  } catch (error) {
    return {
      toolName: "web_research",
      ok: false,
      observation: `联网搜索暂时不可用：${error instanceof Error ? error.message : "unknown error"}。已保留工具调用记录，任务继续执行。`,
      payload: { query, error: error instanceof Error ? error.message : String(error) }
    };
  }
}

async function runWebFetch(input: AgentToolInput): Promise<AgentToolResult> {
  const url = extractUrl(`${input.step} ${input.prompt}`);
  if (!url) {
    return {
      toolName: "web_fetch",
      ok: true,
      observation: "当前步骤没有检测到 URL，跳过网页读取。",
      payload: { url: null }
    };
  }

  try {
    const html = await fetchText(url);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const text = stripHtml(html).slice(0, 2000);
    return {
      toolName: "web_fetch",
      ok: true,
      observation: `已读取网页 ${url}${title ? `，标题：${stripHtml(title)}` : ""}。`,
      payload: { url, title: title ? stripHtml(title) : null, text }
    };
  } catch (error) {
    return {
      toolName: "web_fetch",
      ok: false,
      observation: `网页读取失败：${error instanceof Error ? error.message : "unknown error"}。`,
      payload: { url, error: error instanceof Error ? error.message : String(error) }
    };
  }
}

async function runLocalBrowser(input: AgentToolInput): Promise<AgentToolResult> {
  const joinedPrompt = `${input.step} ${input.prompt}`;
  const requestedUrl = extractUrl(joinedPrompt);
  if (requestedUrl && /本地浏览器|已登录态|登录态|chrome|paywall|captcha|打开|访问|navigate/i.test(joinedPrompt)) {
    const action = await runLocalBrowserAction({
      action: "navigate",
      url: requestedUrl,
      waitMs: 900,
      ownerId: input.ownerId,
      source: "agent"
    });
    if (!action.ok) {
      return {
        toolName: "local_browser",
        ok: false,
        observation: `本地浏览器导航未完成：${action.error ?? "无法操作 Chrome"}。`,
        payload: action as unknown as Record<string, unknown>
      };
    }
    return {
      toolName: "local_browser",
      ok: true,
      observation: `已通过本地浏览器访问 ${action.url ?? requestedUrl}，并读取页面快照。`,
      payload: action as unknown as Record<string, unknown>
    };
  }

  if (/截图|screenshot|屏幕|视觉/.test(joinedPrompt)) {
    const screenshot = await screenshotLocalBrowserTab({
      quality: 70,
      ownerId: input.ownerId,
      source: "agent"
    });
    if (!screenshot.ok) {
      return {
        toolName: "local_browser",
        ok: false,
        observation: `本地浏览器截图未完成：${screenshot.error ?? "无法截取 Chrome 页面"}。`,
        payload: screenshot as unknown as Record<string, unknown>
      };
    }
    return {
      toolName: "local_browser",
      ok: true,
      observation: `已截取本地浏览器当前标签页：${screenshot.title ?? screenshot.url ?? "未命名页面"}。`,
      payload: {
        ...screenshot,
        imageBytesApprox: screenshot.dataUrl ? Math.round((screenshot.dataUrl.length * 3) / 4) : 0
      } as unknown as Record<string, unknown>
    };
  }

  const snapshot = await snapshotLocalBrowserTab({
    maxChars: 5000,
    ownerId: input.ownerId,
    source: "agent"
  });
  if (!snapshot.ok) {
    return {
      toolName: "local_browser",
      ok: false,
      observation: `本地浏览器读取未完成：${snapshot.error ?? "未连接 Chrome CDP"}。`,
      payload: snapshot as unknown as Record<string, unknown>
    };
  }

  return {
    toolName: "local_browser",
    ok: true,
    observation: `已读取本地浏览器当前标签页：${snapshot.title ?? snapshot.url ?? "未命名页面"}，获得约 ${snapshot.text?.length ?? 0} 个字符。`,
    payload: {
      ...snapshot,
      promptHint: input.prompt.slice(0, 160)
    } as unknown as Record<string, unknown>
  };
}

async function runMyComputer(input: AgentToolInput): Promise<AgentToolResult> {
  const joinedPrompt = `${input.step} ${input.prompt}`;
  const lower = joinedPrompt.toLowerCase();
  const status = await getMyComputerStatus(input.ownerId);
  const root = status.allowedRoots[0];

  if (/剪贴板|clipboard/.test(lower)) {
    const shouldRead = /读取|读|查看|read|paste/.test(lower);
    const operation = await createMyComputerSystemOperation({
      ownerId: input.ownerId,
      kind: shouldRead ? "clipboard_read" : "clipboard_write",
      text: shouldRead ? undefined : input.step.slice(0, 500) || "ManusXL My Computer clipboard draft",
      dryRun: true
    });
    return {
      toolName: "my_computer",
      ok: true,
      observation: shouldRead
        ? "已创建剪贴板读取授权请求，等待用户 Allow Once 或 Always Allow 后执行。"
        : "已创建剪贴板写入授权请求，等待用户 Allow Once 或 Always Allow 后执行。",
      payload: { status, operation } as unknown as Record<string, unknown>
    };
  }

  if (/启动|打开.*应用|app|calculator|excel|word|pages|numbers/.test(lower)) {
    const appName =
      joinedPrompt.match(/(?:启动|打开)\s*([A-Za-z0-9\u4e00-\u9fa5 ._-]{2,40})/)?.[1]?.trim() ??
      "Calculator";
    const operation = await createMyComputerSystemOperation({
      ownerId: input.ownerId,
      kind: "app_launch",
      target: appName,
      dryRun: true
    });
    return {
      toolName: "my_computer",
      ok: true,
      observation: `已创建启动 ${appName} 的动作授权请求，尚未真正打开应用。`,
      payload: { status, operation } as unknown as Record<string, unknown>
    };
  }

  const mode: "classify" | "dedupe" | "rename" =
    /查重|重复|duplicate|dedupe/.test(lower)
      ? "dedupe"
      : /重命名|rename/.test(lower)
        ? "rename"
        : "classify";
  const plan = await planMyComputerFileOperation({
    ownerId: input.ownerId,
    root,
    mode,
    maxFiles: 120
  });

  return {
    toolName: "my_computer",
    ok: true,
    observation: `已在 My Computer 允许目录生成 ${mode} dry-run，共 ${plan.summary.actionCount} 个待授权动作；默认不改动本机文件。`,
    payload: {
      status,
      plan
    } as unknown as Record<string, unknown>
  };
}

function extractUploadedFileSummary(prompt: string) {
  const marker = "[上传文件摘要]";
  const index = prompt.indexOf(marker);
  if (index === -1) return null;
  return prompt.slice(index + marker.length).trim().slice(0, 3000);
}

function extractUploadedFileEntries(prompt: string) {
  const summary = extractUploadedFileSummary(prompt);
  if (!summary) return [];

  return summary
    .split(/\n(?=文件：)/)
    .map((block) => {
      const name = block.match(/文件：(.+)/)?.[1]?.trim() ?? "unnamed";
      const type = block.match(/类型：([^，\n]+)/)?.[1]?.trim() ?? "unknown";
      const size = block.match(/大小：([^\n]+)/)?.[1]?.trim() ?? "unknown";
      const preview = block.match(/正文预览：([\s\S]+)/)?.[1]?.trim() ?? "";
      return { name, type, size, preview };
    })
    .filter((file) => file.name !== "unnamed");
}

interface UploadedFileToolEntry {
  id?: string;
  name: string;
  type: string;
  size: string;
  preview: string;
  summary?: string;
  metadata?: Record<string, string | number | boolean>;
  workspacePath?: string;
  relativePath?: string;
}

function safeUploadedFilename(record: UploadedFileRecord, index: number) {
  const safeName = basename(record.name)
    .replace(/[/:*?"<>|\\]/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 140);
  return `${String(index + 1).padStart(3, "0")}-${safeName || "upload.bin"}`;
}

function uploadedRecordToEntry(
  record: UploadedFileRecord,
  materialized?: { workspacePath: string; relativePath: string }
): UploadedFileToolEntry {
  return {
    id: record.id,
    name: record.name,
    type: record.extension || record.mimeType,
    size: formatBytes(record.size),
    preview: record.textPreview,
    summary: record.summary,
    metadata: record.metadata,
    workspacePath: materialized?.workspacePath,
    relativePath: materialized?.relativePath
  };
}

async function materializeUploadedFiles(input: AgentToolInput) {
  const records = listUploadedFileRecords(input.ownerId, input.uploadedFileIds ?? []);
  if (records.length === 0) {
    return {
      files: [] as UploadedFileToolEntry[],
      manifestPath: null as string | null,
      uploadDir: null as string | null
    };
  }

  const { tmp } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const uploadDir = join(tmp, "uploads");
  const files: UploadedFileToolEntry[] = [];
  await mkdir(uploadDir, { recursive: true });

  for (const [index, record] of records.entries()) {
    const fileName = safeUploadedFilename(record, index);
    const workspacePath = join(uploadDir, fileName);
    const relativePath = `tmp/uploads/${fileName}`;
    await cp(record.storedPath, workspacePath, { force: true });
    files.push(uploadedRecordToEntry(record, { workspacePath, relativePath }));
  }

  const manifestPath = join(uploadDir, "uploads-manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        taskId: input.taskId,
        fileCount: files.length,
        files: files.map((file) => ({
          id: file.id,
          name: file.name,
          type: file.type,
          size: file.size,
          relativePath: file.relativePath,
          summary: file.summary,
          metadata: file.metadata
        }))
      },
      null,
      2
    )
  );

  return { files, manifestPath, uploadDir };
}

async function getUploadedFileToolEntries(input: AgentToolInput) {
  const materialized = await materializeUploadedFiles(input);
  if (materialized.files.length > 0) return materialized;

  return {
    files: extractUploadedFileEntries(input.prompt) as UploadedFileToolEntry[],
    manifestPath: null as string | null,
    uploadDir: null as string | null
  };
}

function classifyUploadedFile(type: string, name: string) {
  const value = `${type} ${name}`.toLowerCase();
  if (/png|jpg|jpeg|webp|gif|image|图片/.test(value)) return "images";
  if (/pdf/.test(value)) return "pdf";
  if (/xlsx|csv|tsv|excel|sheet/.test(value)) return "spreadsheets";
  if (/docx|word|md|txt/.test(value)) return "documents";
  return "other";
}

function makeSafeBasename(value: string, index: number) {
  const ext = value.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  const stem = value
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${String(index + 1).padStart(3, "0")}-${stem || "file"}${ext}`;
}

function csvEscape(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function batchPlanCsv(operations: Array<Record<string, string | boolean>>) {
  const headers = ["operation", "source", "target", "category", "dryRun"];
  return [
    headers.join(","),
    ...operations.map((operation) =>
      headers.map((header) => csvEscape(String(operation[header] ?? ""))).join(",")
    )
  ].join("\n");
}

function batchPlanReadme(operationCount: number) {
  return [
    "# ManusXL Batch File Ops",
    "",
    "This package contains a safe reviewable batch file operation plan.",
    "",
    "Files:",
    "- batch-plan.json: machine-readable operation list.",
    "- batch-plan.csv: spreadsheet-friendly operation list.",
    "- apply-batch-ops.sh: optional shell script for applying the plan locally.",
    "",
    "The shell script is dry-run by default. Put source files under an `input/` folder, inspect the plan, then run:",
    "",
    "```bash",
    "DRY_RUN=1 sh apply-batch-ops.sh",
    "DRY_RUN=0 sh apply-batch-ops.sh",
    "```",
    "",
    `Operation count: ${operationCount}`
  ].join("\n");
}

function batchShellScript(operations: Array<{ source: string; target: string }>) {
  return [
    "#!/bin/sh",
    "set -eu",
    "DRY_RUN=${DRY_RUN:-1}",
    "INPUT_DIR=${INPUT_DIR:-input}",
    "OUTPUT_DIR=${OUTPUT_DIR:-output}",
    "",
    "copy_file() {",
    "  src=\"$INPUT_DIR/$1\"",
    "  dest=\"$OUTPUT_DIR/$2\"",
    "  mkdir -p \"$(dirname \"$dest\")\"",
    "  if [ \"$DRY_RUN\" = \"1\" ]; then",
    "    printf '[dry-run] cp %s %s\\n' \"$src\" \"$dest\"",
    "  else",
    "    cp \"$src\" \"$dest\"",
    "  fi",
    "}",
    "",
    ...operations.map((operation) => `copy_file ${shellQuote(operation.source)} ${shellQuote(operation.target)}`),
    "",
    "printf 'Batch file operations complete. DRY_RUN=%s\\n' \"$DRY_RUN\""
  ].join("\n");
}

async function runFileReader(input: AgentToolInput): Promise<AgentToolResult> {
  const summary = extractUploadedFileSummary(input.prompt);
  const materialized = await materializeUploadedFiles(input);
  if (!summary && materialized.files.length === 0) {
    return {
      toolName: "file_reader",
      ok: true,
      observation: "当前任务没有检测到已上传文件摘要，文件读取工具暂不需要额外处理。",
      payload: { files: [] }
    };
  }

  const fileCount = materialized.files.length || (summary?.match(/^文件：/gm) ?? []).length || 1;
  return {
    toolName: "file_reader",
    ok: true,
    observation:
      materialized.files.length > 0
        ? `已读取 ${fileCount} 个上传文件的解析摘要，并将真实文件挂载到任务工作区 tmp/uploads。`
        : `已读取 ${fileCount} 个上传文件的解析摘要，并将其作为本轮任务上下文。`,
    payload: {
      fileCount,
      summary,
      files: materialized.files,
      uploadDir: materialized.uploadDir,
      manifestPath: materialized.manifestPath
    }
  };
}

async function runFileWorkspace(input: AgentToolInput): Promise<AgentToolResult> {
  const { root, tmp, artifacts, memoryFile } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const materialized = await materializeUploadedFiles(input);

  const notesPath = join(tmp, "agent-notes.md");
  const manifestPath = join(artifacts, "manifest.md");
  const memoryNotePath = memoryFile;
  await writeFile(
    notesPath,
    [`# Agent Notes`, ``, `Task: ${input.prompt}`, ``, `Step: ${input.step}`].join("\n")
  );
  await writeFile(
    manifestPath,
    [
      `# Artifact Manifest`,
      ``,
      `Task ID: ${input.taskId}`,
      `Created: ${new Date().toISOString()}`,
      ``,
      `## Uploaded Files`,
      ...(materialized.files.length > 0
        ? materialized.files.map((file) => `- ${file.name} -> ${file.relativePath}`)
        : ["- No uploaded files attached to this task."])
    ].join("\n")
  );
  await appendFile(
    memoryNotePath,
    [
      ``,
      `## Workspace File Step`,
      `Time: ${new Date().toISOString()}`,
      ``,
      `Task: ${input.prompt}`,
      ``,
      `Latest workspace step: ${input.step}`
    ].join("\n")
  );

  return {
    toolName: "file_workspace",
    ok: true,
    observation:
      materialized.files.length > 0
        ? `已创建真实任务工作区，挂载 ${materialized.files.length} 个上传文件，并写入 tmp/agent-notes.md、artifacts/manifest.md 与 memory/agent-memory.md。`
        : "已创建真实任务工作区，并写入 tmp/agent-notes.md、artifacts/manifest.md 与 memory/agent-memory.md。",
    payload: {
      workspaceRoot: root,
      uploadedFiles: materialized.files,
      uploadManifestPath: materialized.manifestPath,
      files: [notesPath, manifestPath, memoryNotePath, materialized.manifestPath].filter(Boolean)
    }
  };
}

async function runBatchFileOps(input: AgentToolInput): Promise<AgentToolResult> {
  const uploaded = await getUploadedFileToolEntries(input);
  const files = uploaded.files;
  const operations = files.map((file, index) => {
    const folder = classifyUploadedFile(file.type, file.name);
    return {
      source: file.name,
      target: `${folder}/${makeSafeBasename(file.name, index)}`,
      category: folder,
      operation: "rename_and_classify",
      dryRun: true
    };
  });

  if (operations.length === 0) {
    return {
      toolName: "batch_file_ops",
      ok: true,
      observation: "未检测到上传文件清单，已跳过批量文件操作。",
      payload: { operations: [], dryRun: true }
    };
  }

  const { tmp, artifacts } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const outputPath = join(tmp, "batch-file-ops-dry-run.json");
  const packageDir = join(artifacts, "batch-file-ops");
  const planJson = JSON.stringify({ operations }, null, 2);
  const planCsv = batchPlanCsv(operations);
  const script = batchShellScript(operations);
  const readme = batchPlanReadme(operations.length);
  const packageZip = makeZip([
    { name: "README.md", data: Buffer.from(readme) },
    { name: "batch-plan.json", data: Buffer.from(planJson) },
    { name: "batch-plan.csv", data: Buffer.from(planCsv) },
    { name: "apply-batch-ops.sh", data: Buffer.from(script) }
  ]);

  await writeFile(outputPath, planJson);
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, "README.md"), readme);
  await writeFile(join(packageDir, "batch-plan.json"), planJson);
  await writeFile(join(packageDir, "batch-plan.csv"), planCsv);
  await writeFile(join(packageDir, "apply-batch-ops.sh"), script, { mode: 0o755 });
  await writeFile(join(packageDir, "batch-file-ops-package.zip"), packageZip);

  return {
    toolName: "batch_file_ops",
    ok: true,
    observation: `已为 ${operations.length} 个文件生成批量重命名/分类 dry-run 清单和可下载批处理包，默认不改动原文件。`,
    payload: {
      dryRun: true,
      outputPath,
      packageDir,
      sourceFiles: files,
      uploadManifestPath: uploaded.manifestPath,
      operations,
      generatedArtifacts: [
        {
          name: "batch-file-ops-plan.json",
          type: "json",
          mimeType: "application/json; charset=utf-8",
          content: planJson
        },
        {
          name: "batch-file-ops-plan.csv",
          type: "csv",
          mimeType: "text/csv; charset=utf-8",
          content: planCsv
        },
        {
          name: "apply-batch-file-ops.sh",
          type: "txt",
          mimeType: "text/x-shellscript; charset=utf-8",
          content: script
        },
        {
          name: "batch-file-ops-package.zip",
          type: "zip",
          mimeType: "application/zip",
          content: packageZip.toString("base64"),
          contentEncoding: "base64"
        }
      ]
    }
  };
}

type ImageProcessStatus = "processed" | "skipped" | "failed";

interface ImageProcessOperation {
  source: string;
  sourcePath?: string;
  outputName: string;
  outputPath?: string;
  originalSizeBytes?: number;
  outputSizeBytes?: number;
  status: ImageProcessStatus;
  error?: string;
}

function parseImageProcessingOptions(prompt: string) {
  const lower = prompt.toLowerCase();
  const targetKb = Number(
    prompt.match(/(\d{2,5})\s*(?:kb|k\b|千字节)/i)?.[1] ??
      (lower.includes("500kb") ? "500" : "")
  );
  const maxDimension = Number(
    prompt.match(/(?:边长|最长边|宽度|高度|缩放到|resize).{0,12}?(\d{2,5})\s*(?:px|像素)?/i)?.[1] ??
      prompt.match(/(\d{2,5})\s*(?:px|像素)/i)?.[1] ??
      ""
  );
  const rotateDegrees = Number(
    prompt.match(/(?:旋转|rotate).{0,8}?(-?\d{1,3})/i)?.[1] ?? ""
  );
  const requestedFormat =
    lower.match(/\b(webp|png|jpe?g|gif|tiff?)\b/)?.[1] ??
    prompt.match(/(?:转成|转换为|格式转换为)\s*(webp|png|jpe?g|gif|tiff?)/i)?.[1];
  const normalizedFormat = requestedFormat
    ? requestedFormat.toLowerCase().replace("jpg", "jpeg").replace("tif", "tiff")
    : undefined;
  const quality = Number(prompt.match(/(?:质量|quality).{0,8}?(\d{1,3})/i)?.[1] ?? "");

  return {
    targetBytes: Number.isFinite(targetKb) && targetKb > 0 ? Math.floor(targetKb * 1024) : undefined,
    maxDimension: Number.isFinite(maxDimension) && maxDimension > 0 ? Math.floor(maxDimension) : undefined,
    rotateDegrees: Number.isFinite(rotateDegrees) ? rotateDegrees : undefined,
    format: normalizedFormat,
    quality:
      Number.isFinite(quality) && quality > 0
        ? Math.min(100, Math.max(1, Math.floor(quality)))
        : undefined
  };
}

function isImageEntry(file: UploadedFileToolEntry) {
  return /png|jpg|jpeg|webp|gif|tiff|image|图片/i.test(`${file.type} ${file.name}`);
}

function originalImageFormat(file: UploadedFileToolEntry) {
  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (extension === "jpg") return "jpeg";
  if (extension === "tif") return "tiff";
  if (extension) return extension;
  if (/jpeg|jpg/i.test(file.type)) return "jpeg";
  if (/png/i.test(file.type)) return "png";
  if (/gif/i.test(file.type)) return "gif";
  return "jpeg";
}

function supportedSipsFormat(format: string) {
  return ["jpeg", "png", "gif", "tiff"].includes(format);
}

function imageExtension(format: string) {
  if (format === "jpeg") return "jpg";
  if (format === "tiff") return "tiff";
  return format;
}

function processedImageName(file: UploadedFileToolEntry, index: number, format: string) {
  const stem =
    basename(file.name)
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 52) || "image";
  return `${String(index + 1).padStart(3, "0")}-${stem}.${imageExtension(format)}`;
}

function imageProcessCsv(operations: ImageProcessOperation[]) {
  const headers = [
    "source",
    "outputName",
    "status",
    "originalSizeBytes",
    "outputSizeBytes",
    "sourcePath",
    "outputPath",
    "error"
  ];
  return [
    headers.join(","),
    ...operations.map((operation) =>
      headers
        .map((header) => csvEscape(String(operation[header as keyof ImageProcessOperation] ?? "")))
        .join(",")
    )
  ].join("\n");
}

async function emitToolProgress(input: AgentToolInput, progress: AgentToolProgress) {
  await input.emitProgress?.(progress);
}

function imageQualityAttempts(options: ReturnType<typeof parseImageProcessingOptions>) {
  if (!options.targetBytes) return [options.quality ?? 75];
  return Array.from(new Set([options.quality ?? 82, 70, 58, 46, 34]));
}

function imageDimensionAttempts(options: ReturnType<typeof parseImageProcessingOptions>) {
  if (options.maxDimension) {
    return Array.from(
      new Set([
        options.maxDimension,
        Math.floor(options.maxDimension * 0.85),
        Math.floor(options.maxDimension * 0.7)
      ].filter((value) => value > 0))
    );
  }
  if (options.targetBytes) return [undefined, 1800, 1400, 1000, 760] as Array<number | undefined>;
  return [undefined] as Array<number | undefined>;
}

async function sipsConvertImage(params: {
  inputPath: string;
  outputPath: string;
  format: string;
  quality: number;
  maxDimension?: number;
  rotateDegrees?: number;
}) {
  const args = ["-s", "format", params.format];
  if (params.format === "jpeg") {
    args.push("-s", "formatOptions", String(params.quality));
  }
  if (params.maxDimension) {
    args.push("-Z", String(params.maxDimension));
  }
  if (params.rotateDegrees) {
    args.push("-r", String(params.rotateDegrees));
  }
  args.push(params.inputPath, "--out", params.outputPath);

  await execFileAsync("/usr/bin/sips", args, {
    timeout: getToolExecutionLimits().timeoutMs,
    maxBuffer: getToolExecutionLimits().maxBufferBytes
  });
}

async function processImageWithSips(
  file: UploadedFileToolEntry,
  index: number,
  outputDir: string,
  options: ReturnType<typeof parseImageProcessingOptions>
): Promise<ImageProcessOperation> {
  const format = options.format ?? (options.targetBytes ? "jpeg" : originalImageFormat(file));
  const outputName = processedImageName(file, index, format);
  const outputPath = join(outputDir, outputName);

  if (!file.workspacePath) {
    return {
      source: file.name,
      outputName,
      status: "skipped",
      error: "缺少真实文件路径，只能生成处理计划。"
    };
  }
  if (!supportedSipsFormat(format)) {
    return {
      source: file.name,
      sourcePath: file.relativePath,
      outputName,
      status: "skipped",
      error: `当前本地图片引擎暂不支持输出 ${format.toUpperCase()}，可先转换为 JPEG/PNG/GIF/TIFF。`
    };
  }

  const originalSizeBytes = (await stat(file.workspacePath)).size;
  let lastError = "";

  for (const maxDimension of imageDimensionAttempts(options)) {
    for (const quality of imageQualityAttempts(options)) {
      try {
        await sipsConvertImage({
          inputPath: file.workspacePath,
          outputPath,
          format,
          quality,
          maxDimension,
          rotateDegrees: options.rotateDegrees
        });
        const outputSizeBytes = (await stat(outputPath)).size;
        if (!options.targetBytes || outputSizeBytes <= options.targetBytes) {
          return {
            source: file.name,
            sourcePath: file.relativePath,
            outputName,
            outputPath,
            originalSizeBytes,
            outputSizeBytes,
            status: "processed"
          };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  try {
    const outputSizeBytes = (await stat(outputPath)).size;
    return {
      source: file.name,
      sourcePath: file.relativePath,
      outputName,
      outputPath,
      originalSizeBytes,
      outputSizeBytes,
      status: "processed",
      error: options.targetBytes
        ? `已处理，但未压缩到目标 ${formatBytes(options.targetBytes)} 以内。`
        : undefined
    };
  } catch {
    return {
      source: file.name,
      sourcePath: file.relativePath,
      outputName,
      originalSizeBytes,
      status: "failed",
      error: lastError || "图片处理失败。"
    };
  }
}

async function runBatchImageProcess(input: AgentToolInput): Promise<AgentToolResult> {
  const uploaded = await getUploadedFileToolEntries(input);
  const imageFiles = uploaded.files.filter(isImageEntry);

  if (imageFiles.length === 0) {
    return {
      toolName: "batch_image_process",
      ok: true,
      observation: "未检测到可处理的上传图片，已跳过批量图片处理。",
      payload: { files: [], operations: [] }
    };
  }

  const options = parseImageProcessingOptions(input.prompt);
  const { artifacts } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const outputDir = join(artifacts, "processed-images");
  await mkdir(outputDir, { recursive: true });

  const startedAt = Date.now();
  const operations: ImageProcessOperation[] = [];
  for (const [index, file] of imageFiles.entries()) {
    await emitToolProgress(input, {
      title: "图片处理进度",
      content: `正在处理第 ${index + 1}/${imageFiles.length} 张图片：${file.name}`,
      payload: {
        tool: "batch_image_process",
        current: index + 1,
        total: imageFiles.length,
        fileName: file.name,
        phase: "start"
      }
    });
    const operation = await processImageWithSips(file, index, outputDir, options);
    operations.push(operation);
    await emitToolProgress(input, {
      title: "图片处理进度",
      content: `已处理第 ${index + 1}/${imageFiles.length} 张图片：${file.name}（${operation.status}）`,
      payload: {
        tool: "batch_image_process",
        current: index + 1,
        total: imageFiles.length,
        fileName: file.name,
        status: operation.status,
        outputName: operation.outputName,
        outputSizeBytes: operation.outputSizeBytes,
        phase: "finish"
      }
    });
  }
  const processingDurationMs = Date.now() - startedAt;

  const processed = operations.filter((operation) => operation.status === "processed");
  const report = JSON.stringify(
    {
      taskId: input.taskId,
      generatedAt: new Date().toISOString(),
      processingDurationMs,
      options: {
        targetBytes: options.targetBytes,
        maxDimension: options.maxDimension,
        rotateDegrees: options.rotateDegrees,
        format: options.format,
        quality: options.quality,
        engine: "macOS sips"
      },
      sourceFiles: imageFiles,
      operations
    },
    null,
    2
  );
  const csv = imageProcessCsv(operations);
  const zipEntries = [
    { name: "image-process-report.json", data: Buffer.from(report) },
    { name: "image-process-report.csv", data: Buffer.from(csv) },
    ...(
      await Promise.all(
        processed.map(async (operation) => ({
          name: `images/${operation.outputName}`,
          data: await readFile(operation.outputPath as string)
        }))
      )
    )
  ];
  const zip = makeZip(zipEntries);

  await writeFile(join(outputDir, "image-process-report.json"), report);
  await writeFile(join(outputDir, "image-process-report.csv"), csv);
  await writeFile(join(outputDir, "batch-image-process-package.zip"), zip);

  return {
    toolName: "batch_image_process",
    ok: true,
    observation:
      processed.length > 0
        ? `已处理 ${processed.length}/${imageFiles.length} 张上传图片，并生成处理报告和 ZIP 结果包。`
        : `已生成 ${imageFiles.length} 张上传图片的处理计划，但当前环境没有完成实际转换。`,
    payload: {
      options,
      processingDurationMs,
      sourceFiles: imageFiles,
      operations,
      generatedArtifacts: [
        {
          name: "batch-image-process-report.json",
          type: "json",
          mimeType: "application/json; charset=utf-8",
          content: report
        },
        {
          name: "batch-image-process-report.csv",
          type: "csv",
          mimeType: "text/csv; charset=utf-8",
          content: csv
        },
        {
          name: "batch-image-process-package.zip",
          type: "zip",
          mimeType: "application/zip",
          content: zip.toString("base64"),
          contentEncoding: "base64"
        }
      ]
    }
  };
}

type OcrOperationStatus = "extracted" | "engine_missing" | "skipped" | "failed";

interface OcrOperation {
  source: string;
  sourcePath?: string;
  status: OcrOperationStatus;
  language?: string;
  textLength: number;
  textPreview: string;
  outputPath?: string;
  error?: string;
}

function parseOcrLanguage(prompt: string) {
  const lower = prompt.toLowerCase();
  if (lower.match(/chi_sim|中英文|中文|汉字|发票|名片|简体/)) return "chi_sim+eng";
  if (/[\u4e00-\u9fa5]/.test(prompt)) return "chi_sim+eng";
  if (lower.match(/\beng\b|英文|english/)) return "eng";
  return "eng";
}

function normalizeOcrText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12000);
}

function safeOcrTextName(file: UploadedFileToolEntry, index: number) {
  const stem =
    basename(file.name)
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 52) || "image";
  return `${String(index + 1).padStart(3, "0")}-${stem}.txt`;
}

async function tesseractOcr(filePath: string, language: string) {
  const limits = getToolExecutionLimits();
  const run = async (lang: string) =>
    (await execFileAsync("tesseract", [filePath, "stdout", "-l", lang], {
      timeout: Math.max(limits.timeoutMs, 15_000),
      maxBuffer: limits.maxBufferBytes
    })) as { stdout: string; stderr: string };

  try {
    const { stdout } = await run(language);
    return { text: normalizeOcrText(stdout), language };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (language !== "eng" && /failed loading language|could not initialize tesseract|error opening data file/i.test(message)) {
      const { stdout } = await run("eng");
      return { text: normalizeOcrText(stdout), language: "eng" };
    }
    throw error;
  }
}

function imageOcrCsv(operations: OcrOperation[]) {
  const headers = ["source", "status", "language", "textLength", "sourcePath", "outputPath", "textPreview", "error"];
  return [
    headers.join(","),
    ...operations.map((operation) =>
      headers
        .map((header) => csvEscape(String(operation[header as keyof OcrOperation] ?? "")))
        .join(",")
    )
  ].join("\n");
}

function imageOcrMarkdown(params: {
  prompt: string;
  language: string;
  engineAvailable: boolean;
  engineVersion?: string;
  operations: OcrOperation[];
}) {
  return [
    "# Image OCR Report",
    "",
    `Task: ${params.prompt}`,
    `Language: ${params.language}`,
    `Engine: ${params.engineAvailable ? params.engineVersion ?? "tesseract" : "not installed"}`,
    "",
    "| File | Status | Text length | Preview |",
    "|------|--------|-------------|---------|",
    ...params.operations.map((operation) =>
      [
        operation.source,
        operation.status,
        String(operation.textLength),
        (operation.textPreview || operation.error || "").replace(/\n/g, " ").slice(0, 120)
      ]
        .map((value) => value.replace(/\|/g, "\\|"))
        .join(" | ")
    ),
    "",
    params.engineAvailable
      ? "OCR engine executed for available image files."
      : "OCR engine is not installed. Install `tesseract` and the needed language packs, then rerun the task."
  ].join("\n");
}

async function runImageOcr(input: AgentToolInput): Promise<AgentToolResult> {
  const uploaded = await getUploadedFileToolEntries(input);
  const imageFiles = uploaded.files.filter(isImageEntry);

  if (imageFiles.length === 0) {
    return {
      toolName: "image_ocr",
      ok: true,
      observation: "未检测到可 OCR 的上传图片，已跳过图片文字识别。",
      payload: { files: [], operations: [] }
    };
  }

  const language = parseOcrLanguage(input.prompt);
  const engine = await getOcrStatus();
  const { artifacts } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const outputDir = join(artifacts, "image-ocr");
  const textDir = join(outputDir, "text");
  await mkdir(textDir, { recursive: true });

  const operations: OcrOperation[] = [];
  for (const [index, file] of imageFiles.entries()) {
    const outputName = safeOcrTextName(file, index);
    const outputPath = join(textDir, outputName);
    await emitToolProgress(input, {
      title: "OCR 进度",
      content: `正在识别第 ${index + 1}/${imageFiles.length} 张图片：${file.name}`,
      payload: {
        tool: "image_ocr",
        current: index + 1,
        total: imageFiles.length,
        fileName: file.name,
        phase: "start"
      }
    });

    if (!file.workspacePath) {
      const operation: OcrOperation = {
        source: file.name,
        sourcePath: file.relativePath,
        status: "skipped",
        textLength: 0,
        textPreview: "",
        error: "缺少真实文件路径，只能生成 OCR 计划。"
      };
      operations.push(operation);
      await emitToolProgress(input, {
        title: "OCR 进度",
        content: `已跳过第 ${index + 1}/${imageFiles.length} 张图片：${file.name}`,
        payload: {
          tool: "image_ocr",
          current: index + 1,
          total: imageFiles.length,
          fileName: file.name,
          status: operation.status,
          phase: "finish"
        }
      });
      continue;
    }

    if (!engine.available) {
      const operation: OcrOperation = {
        source: file.name,
        sourcePath: file.relativePath,
        status: "engine_missing",
        language,
        textLength: 0,
        textPreview: "",
        error: "当前环境未安装 tesseract OCR 引擎。"
      };
      operations.push(operation);
      await emitToolProgress(input, {
        title: "OCR 进度",
        content: `OCR 引擎缺失，第 ${index + 1}/${imageFiles.length} 张图片已记录诊断：${file.name}`,
        payload: {
          tool: "image_ocr",
          current: index + 1,
          total: imageFiles.length,
          fileName: file.name,
          status: operation.status,
          phase: "finish"
        }
      });
      continue;
    }

    try {
      const result = await tesseractOcr(file.workspacePath, language);
      await writeFile(outputPath, result.text || "");
      const operation: OcrOperation = {
        source: file.name,
        sourcePath: file.relativePath,
        status: "extracted",
        language: result.language,
        textLength: result.text.length,
        textPreview: result.text.slice(0, 300),
        outputPath
      };
      operations.push(operation);
      await emitToolProgress(input, {
        title: "OCR 进度",
        content: `已识别第 ${index + 1}/${imageFiles.length} 张图片：${file.name}，提取 ${operation.textLength} 个字符`,
        payload: {
          tool: "image_ocr",
          current: index + 1,
          total: imageFiles.length,
          fileName: file.name,
          status: operation.status,
          textLength: operation.textLength,
          phase: "finish"
        }
      });
    } catch (error) {
      const operation: OcrOperation = {
        source: file.name,
        sourcePath: file.relativePath,
        status: "failed",
        language,
        textLength: 0,
        textPreview: "",
        error: error instanceof Error ? error.message : String(error)
      };
      operations.push(operation);
      await emitToolProgress(input, {
        title: "OCR 进度",
        content: `第 ${index + 1}/${imageFiles.length} 张图片 OCR 失败：${file.name}`,
        payload: {
          tool: "image_ocr",
          current: index + 1,
          total: imageFiles.length,
          fileName: file.name,
          status: operation.status,
          phase: "finish"
        }
      });
    }
  }

  const extracted = operations.filter((operation) => operation.status === "extracted");
  const report = JSON.stringify(
    {
      taskId: input.taskId,
      generatedAt: new Date().toISOString(),
      language,
      engine: {
        name: "tesseract",
        available: engine.available,
        version: engine.available ? engine.version : undefined,
        reason: engine.available ? undefined : engine.reason
      },
      sourceFiles: imageFiles,
      operations,
      installHint: engine.available
        ? undefined
        : engine.installHint
    },
    null,
    2
  );
  const csv = imageOcrCsv(operations);
  const markdown = imageOcrMarkdown({
    prompt: input.prompt,
    language,
    engineAvailable: engine.available,
    engineVersion: engine.available ? engine.version : undefined,
    operations
  });
  const textEntries = await Promise.all(
    extracted.map(async (operation, index) => ({
      name: `text/${safeOcrTextName({ name: operation.source, type: "txt", size: "", preview: "" }, index)}`,
      data: await readFile(operation.outputPath as string)
    }))
  );
  const zip = makeZip([
    { name: "image-ocr-report.json", data: Buffer.from(report) },
    { name: "image-ocr-report.csv", data: Buffer.from(csv) },
    { name: "image-ocr-report.md", data: Buffer.from(markdown) },
    ...textEntries
  ]);

  await writeFile(join(outputDir, "image-ocr-report.json"), report);
  await writeFile(join(outputDir, "image-ocr-report.csv"), csv);
  await writeFile(join(outputDir, "image-ocr-report.md"), markdown);
  await writeFile(join(outputDir, "image-ocr-package.zip"), zip);

  return {
    toolName: "image_ocr",
    ok: true,
    observation: engine.available
      ? `已对 ${imageFiles.length} 张上传图片执行 OCR，成功提取 ${extracted.length} 个文本结果，并生成 OCR 报告包。`
      : `已生成 ${imageFiles.length} 张上传图片的 OCR 任务报告；当前环境未安装 tesseract，暂未执行真实文字识别。`,
    payload: {
      language,
      engine,
      sourceFiles: imageFiles,
      operations,
      generatedArtifacts: [
        {
          name: "image-ocr-report.json",
          type: "json",
          mimeType: "application/json; charset=utf-8",
          content: report
        },
        {
          name: "image-ocr-report.csv",
          type: "csv",
          mimeType: "text/csv; charset=utf-8",
          content: csv
        },
        {
          name: "image-ocr-report.md",
          type: "md",
          mimeType: "text/markdown; charset=utf-8",
          content: markdown
        },
        {
          name: "image-ocr-package.zip",
          type: "zip",
          mimeType: "application/zip",
          content: zip.toString("base64"),
          contentEncoding: "base64"
        }
      ]
    }
  };
}

function safeSkillWorkspaceName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

function truncateSkillOutput(value: string) {
  return value.trim().slice(0, 6000);
}

async function readOptionalTextFile(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function parseSkillOutput(value: string) {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value) as {
      observation?: unknown;
      markdown?: unknown;
      artifacts?: unknown;
    };
  } catch {
    return {
      observation: value
    };
  }
}

function normalizeSkillArtifacts(
  skillName: string,
  parsedOutput: ReturnType<typeof parseSkillOutput>,
  stdout: string,
  outputJson: string
) {
  const artifacts: Array<{
    name: string;
    type: string;
    mimeType: string;
    content: string;
    contentEncoding?: "text" | "base64";
  }> = [
    {
      name: `${safeSkillWorkspaceName(skillName)}-skill-output.json`,
      type: "json",
      mimeType: "application/json; charset=utf-8",
      content: outputJson || JSON.stringify(parsedOutput, null, 2)
    },
    {
      name: `${safeSkillWorkspaceName(skillName)}-skill-stdout.txt`,
      type: "txt",
      mimeType: "text/plain; charset=utf-8",
      content: stdout || "Skill 脚本没有标准输出。"
    }
  ];

  if (typeof parsedOutput.markdown === "string" && parsedOutput.markdown.trim()) {
    artifacts.push({
      name: `${safeSkillWorkspaceName(skillName)}-skill-result.md`,
      type: "md",
      mimeType: "text/markdown; charset=utf-8",
      content: parsedOutput.markdown
    });
  }

  if (Array.isArray(parsedOutput.artifacts)) {
    for (const artifact of parsedOutput.artifacts.slice(0, 5)) {
      const candidate = artifact as {
        name?: unknown;
        type?: unknown;
        mimeType?: unknown;
        content?: unknown;
        contentEncoding?: unknown;
      };
      if (
        typeof candidate.name === "string" &&
        typeof candidate.type === "string" &&
        typeof candidate.mimeType === "string" &&
        typeof candidate.content === "string"
      ) {
        artifacts.push({
          name: candidate.name,
          type: candidate.type,
          mimeType: candidate.mimeType,
          content: candidate.content,
          contentEncoding:
            candidate.contentEncoding === "base64" || candidate.contentEncoding === "text"
              ? candidate.contentEncoding
              : undefined
        });
      }
    }
  }

  return artifacts;
}

async function runSkillRunner(input: AgentToolInput): Promise<AgentToolResult> {
  const executableSkills = selectExecutableSkillsForPrompt(input.prompt, input.ownerId);
  const skill = executableSkills[0];

  if (!skill) {
    return {
      toolName: "skill_runner",
      ok: false,
      observation: "没有找到与当前任务匹配且包含 Python 执行脚本的本地 Skill。",
      payload: {
        executableSkills: []
      }
    };
  }

  const { root, tmp } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const rootPath = resolve(root);
  const skillWorkspaceName = safeSkillWorkspaceName(skill.id);
  const skillWorkDir = join(resolve(tmp), "skills", skillWorkspaceName);
  const inputPath = join(skillWorkDir, "skill-input.json");
  const outputPath = join(skillWorkDir, "skill-output.json");
  const relativeScript = `tmp/skills/${skillWorkspaceName}/${basename(skill.scriptName)}`;
  const relativeInput = `tmp/skills/${skillWorkspaceName}/skill-input.json`;
  const relativeOutput = `tmp/skills/${skillWorkspaceName}/skill-output.json`;
  const inputJson = JSON.stringify(
    {
      taskId: input.taskId,
      prompt: input.prompt,
      step: input.step,
      stepIndex: input.stepIndex,
      plan: input.plan,
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        triggers: skill.triggers,
        toolsRequired: skill.toolsRequired
      }
    },
    null,
    2
  );

  await mkdir(skillWorkDir, { recursive: true });
  await cp(skill.rootPath, skillWorkDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
    dereference: false
  });
  await writeFile(inputPath, inputJson);

  try {
    const limits = getToolExecutionLimits();
    const { stdout, stderr, sandbox } = await runSandboxedCommand({
      workspaceRoot: rootPath,
      dockerCommand: "python3",
      dockerArgs: [relativeScript, relativeInput, relativeOutput],
      localCommand: "python3",
      localArgs: [join(skillWorkDir, skill.scriptName), inputPath, outputPath],
      localCwd: rootPath,
      timeoutMs: limits.timeoutMs,
      maxBufferBytes: limits.maxBufferBytes
    });
    const outputJson = await readOptionalTextFile(outputPath);
    const parsedOutput = parseSkillOutput(outputJson || stdout);
    const observation =
      typeof parsedOutput.observation === "string" && parsedOutput.observation.trim()
        ? parsedOutput.observation.trim()
        : `已执行本地 Skill「${skill.name}」脚本 ${skill.scriptName}。`;

    return {
      toolName: "skill_runner",
      ok: true,
      observation,
      payload: {
        skill: {
          id: skill.id,
          name: skill.name,
          scriptName: skill.scriptName
        },
        scriptPath: join(skillWorkDir, skill.scriptName),
        inputPath,
        outputPath,
        stdout: truncateSkillOutput(stdout),
        stderr: truncateSkillOutput(stderr),
        parsedOutput,
        sandbox,
        generatedArtifacts: normalizeSkillArtifacts(skill.name, parsedOutput, stdout, outputJson)
      }
    };
  } catch (error) {
    const summary = summarizeProcessError(error, `Skill「${skill.name}」`);
    return {
      toolName: "skill_runner",
      ok: false,
      observation: summary.message,
      payload: {
        skill: {
          id: skill.id,
          name: skill.name,
          scriptName: skill.scriptName
        },
        scriptPath: join(skillWorkDir, skill.scriptName),
        inputPath,
        outputPath,
        errorKind: summary.kind,
        ...processErrorPayload(error)
      }
    };
  }
}

async function runPythonExecute(input: AgentToolInput): Promise<AgentToolResult> {
  const { root, tmp } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const rootPath = resolve(root);
  const tmpPath = resolve(tmp);
  const scriptPath = join(tmpPath, "analysis.py");
  const outputPath = join(tmpPath, "python-analysis.json");
  const script = `import json, pathlib, re

prompt = ${JSON.stringify(input.prompt)}
step = ${JSON.stringify(input.step)}
words = re.findall(r"\\w+", prompt + " " + step, flags=re.UNICODE)
result = {
  "prompt_length": len(prompt),
  "step_length": len(step),
  "keyword_count": len(words),
  "unique_keyword_count": len(set(words)),
  "top_keywords": list(dict.fromkeys(words))[:12],
}
pathlib.Path(__file__).with_name("python-analysis.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
`;
  await writeFile(scriptPath, script);

  try {
    const limits = getToolExecutionLimits();
    const { stdout, stderr, sandbox } = await runSandboxedCommand({
      workspaceRoot: rootPath,
      dockerCommand: "python3",
      dockerArgs: ["tmp/analysis.py"],
      localCommand: "python3",
      localArgs: [scriptPath],
      localCwd: rootPath,
      timeoutMs: limits.timeoutMs,
      maxBufferBytes: limits.maxBufferBytes
    });

    return {
      toolName: "python_execute",
      ok: true,
      observation:
        sandbox.mode === "docker"
          ? "已在 Docker 沙盒中执行受控 Python 分析脚本，并写入 tmp/python-analysis.json。"
          : "已在本地 fallback 中执行受控 Python 分析脚本，并写入 tmp/python-analysis.json。",
      payload: {
        scriptPath,
        outputPath,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        sandbox
      }
    };
  } catch (error) {
    const summary = summarizeProcessError(error, "Python");
    return {
      toolName: "python_execute",
      ok: false,
      observation: summary.message,
      payload: {
        scriptPath,
        outputPath,
        errorKind: summary.kind,
        ...processErrorPayload(error)
      }
    };
  }
}

async function runShellExecute(input: AgentToolInput): Promise<AgentToolResult> {
  const { root, tmp } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const rootPath = resolve(root);
  const outputPath = join(resolve(tmp), "shell-inspection.txt");
  const shellScript = [
    "set -e",
    "pwd",
    "printf '\\n--- workspace files ---\\n'",
    "find . -maxdepth 3 -type f | sort",
    "printf '\\n--- disk usage ---\\n'",
    "du -sh ."
  ].join("\n");

  try {
    const limits = getToolExecutionLimits();
    const { stdout, stderr, sandbox } = await runSandboxedCommand({
      workspaceRoot: rootPath,
      dockerCommand: "sh",
      dockerArgs: ["-c", shellScript],
      localCommand: "sh",
      localArgs: ["-c", shellScript],
      localCwd: rootPath,
      timeoutMs: limits.timeoutMs,
      maxBufferBytes: limits.maxBufferBytes
    });
    await writeFile(outputPath, stdout);

    return {
      toolName: "shell_execute",
      ok: true,
      observation:
        sandbox.mode === "docker"
          ? "已在 Docker 沙盒中执行受控 Shell 检查命令，并写入 tmp/shell-inspection.txt。"
          : "已在本地 fallback 中执行受控 Shell 检查命令，并写入 tmp/shell-inspection.txt。",
      payload: {
        outputPath,
        stdout: stdout.slice(0, 3000),
        stderr: stderr.trim(),
        sandbox
      }
    };
  } catch (error) {
    const summary = summarizeProcessError(error, "Shell");
    return {
      toolName: "shell_execute",
      ok: false,
      observation: summary.message,
      payload: {
        outputPath,
        errorKind: summary.kind,
        ...processErrorPayload(error)
      }
    };
  }
}

function pickMcpServerAndTool(input: AgentToolInput) {
  const servers = listEnabledMcpServers(input.ownerId).filter(
    (server) => server.type === "stdio" && server.status === "healthy" && enabledMcpTools(server).length > 0
  );
  const combined = `${input.prompt}\n${input.step}`.toLowerCase();
  const server =
    servers.find((item) => enabledMcpTools(item).some((tool) => combined.includes(tool.toLowerCase()))) ??
    servers[0];
  if (!server) return null;

  const tools = enabledMcpTools(server);
  const tool =
    tools.find((item) => combined.includes(item.toLowerCase())) ??
    tools.find((item) => /list.*director|list.*file|directory/i.test(item)) ??
    tools[0];

  return { server, tool };
}

function mcpToolArguments(toolName: string, input: AgentToolInput) {
  const lower = toolName.toLowerCase();
  if (/list.*director|list.*file|directory/.test(lower)) return { path: "." };
  if (/search/.test(lower)) return { query: input.step };
  if (/read.*file/.test(lower)) return { path: "README.md" };
  return {
    prompt: input.prompt.slice(0, 1200),
    step: input.step,
    taskId: input.taskId
  };
}

async function runMcpCall(input: AgentToolInput): Promise<AgentToolResult> {
  const target = pickMcpServerAndTool(input);
  if (!target) {
    return {
      toolName: "mcp_call",
      ok: false,
      observation: "当前用户没有可调用的健康 stdio MCP Server。请先在 Settings 添加并启用 MCP Server。",
      payload: { servers: [] }
    };
  }

  try {
    const args = mcpToolArguments(target.tool, input);
    const result = await callMcpServerTool(target.server.id, target.tool, args, input.ownerId);
    return {
      toolName: "mcp_call",
      ok: true,
      observation: `已调用 MCP Server「${target.server.name}」的工具 ${target.tool}。`,
      payload: {
        serverId: target.server.id,
        serverName: target.server.name,
        toolName: target.tool,
        arguments: args,
        result
      }
    };
  } catch (error) {
    return {
      toolName: "mcp_call",
      ok: false,
      observation: `MCP 工具调用失败：${error instanceof Error ? error.message : String(error)}。`,
      payload: {
        serverId: target.server.id,
        serverName: target.server.name,
        toolName: target.tool,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

interface KnownMapPlace {
  names: string[];
  lat: number;
  lon: number;
  region: string;
}

interface MapPlace {
  name: string;
  lat?: number;
  lon?: number;
  region?: string;
  osmUrl: string;
  note: string;
  source: "known" | "prompt";
}

const KNOWN_MAP_PLACES: KnownMapPlace[] = [
  { names: ["北京", "北京市", "beijing"], lat: 39.9042, lon: 116.4074, region: "中国" },
  { names: ["上海", "上海市", "shanghai"], lat: 31.2304, lon: 121.4737, region: "中国" },
  { names: ["广州", "广州市", "guangzhou"], lat: 23.1291, lon: 113.2644, region: "中国" },
  { names: ["深圳", "深圳市", "shenzhen"], lat: 22.5431, lon: 114.0579, region: "中国" },
  { names: ["杭州", "杭州市", "hangzhou"], lat: 30.2741, lon: 120.1551, region: "中国" },
  { names: ["成都", "成都市", "chengdu"], lat: 30.5728, lon: 104.0668, region: "中国" },
  { names: ["重庆", "重庆市", "chongqing"], lat: 29.563, lon: 106.5516, region: "中国" },
  { names: ["西安", "西安市", "xian", "xi'an"], lat: 34.3416, lon: 108.9398, region: "中国" },
  { names: ["南京", "南京市", "nanjing"], lat: 32.0603, lon: 118.7969, region: "中国" },
  { names: ["苏州", "苏州市", "suzhou"], lat: 31.2989, lon: 120.5853, region: "中国" },
  { names: ["武汉", "武汉市", "wuhan"], lat: 30.5928, lon: 114.3055, region: "中国" },
  { names: ["天津", "天津市", "tianjin"], lat: 39.3434, lon: 117.3616, region: "中国" },
  { names: ["东京", "tokyo"], lat: 35.6762, lon: 139.6503, region: "日本" },
  { names: ["大阪", "osaka"], lat: 34.6937, lon: 135.5023, region: "日本" },
  { names: ["京都", "kyoto"], lat: 35.0116, lon: 135.7681, region: "日本" },
  { names: ["奈良", "nara"], lat: 34.6851, lon: 135.8048, region: "日本" },
  { names: ["首尔", "seoul"], lat: 37.5665, lon: 126.978, region: "韩国" },
  { names: ["新加坡", "singapore"], lat: 1.3521, lon: 103.8198, region: "新加坡" },
  { names: ["纽约", "new york"], lat: 40.7128, lon: -74.006, region: "美国" },
  { names: ["西雅图", "seattle"], lat: 47.6062, lon: -122.3321, region: "美国" },
  { names: ["旧金山", "san francisco"], lat: 37.7749, lon: -122.4194, region: "美国" },
  { names: ["伦敦", "london"], lat: 51.5072, lon: -0.1276, region: "英国" },
  { names: ["巴黎", "paris"], lat: 48.8566, lon: 2.3522, region: "法国" }
];

const MAP_CANDIDATE_STOPWORDS = new Set([
  "请",
  "帮我",
  "规划",
  "生成",
  "输出",
  "地图",
  "路线",
  "行程",
  "旅行",
  "旅游",
  "攻略",
  "地址",
  "附近",
  "周边",
  "导航",
  "报告",
  "建议",
  "对比",
  "分析",
  "map",
  "route",
  "itinerary",
  "location"
]);

function openStreetMapUrl(place: { name: string; lat?: number; lon?: number }) {
  if (typeof place.lat === "number" && typeof place.lon === "number") {
    return `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=12/${place.lat}/${place.lon}`;
  }
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(place.name)}`;
}

function cleanMapCandidate(value: string) {
  return value
    .replace(/\[[\s\S]*$/, "")
    .replace(/[“”"「」『』（）()【】[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(从|自|到|至|去|经过|途经|在|给我|帮我|请|规划|生成|输出)+/, "")
    .replace(/(地图|路线|行程|旅行|旅游|攻略|地址|附近|周边|导航|报告|建议|对比|分析)+$/, "")
    .trim();
}

function isUsefulMapCandidate(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.length < 2 || normalized.length > 28) return false;
  if (MAP_CANDIDATE_STOPWORDS.has(normalized)) return false;
  if (!/[\p{Script=Han}A-Za-z0-9]/u.test(value)) return false;
  if (/^(一个|一份|可下载|自包含|html|json|csv)$/i.test(value)) return false;
  return true;
}

function extractMapPlaces(prompt: string, step: string): MapPlace[] {
  const text = `${prompt}\n${step}`;
  const lower = text.toLowerCase();
  const knownMatches = KNOWN_MAP_PLACES.flatMap((place) => {
    const matchedName = place.names.find((name) => lower.includes(name.toLowerCase()));
    if (!matchedName) return [];
    return [
      {
        name: place.names[0],
        lat: place.lat,
        lon: place.lon,
        region: place.region,
        osmUrl: openStreetMapUrl({ name: place.names[0], lat: place.lat, lon: place.lon }),
        note: `已匹配内置地理坐标：${place.region}`,
        source: "known" as const,
        index: lower.indexOf(matchedName.toLowerCase())
      }
    ];
  }).sort((a, b) => a.index - b.index);

  const guessed = text
    .replace(/\[上传文件摘要\][\s\S]*/g, " ")
    .replace(/(从|自|起点|终点|经过|途经|去|到|至|路线|地图|行程|旅行|旅游|攻略|门店|地址|附近|周边|导航)/g, "、")
    .split(/[、，,;；/|｜\n\r\t]+/)
    .map(cleanMapCandidate)
    .filter(isUsefulMapCandidate)
    .map((name) => ({
      name,
      osmUrl: openStreetMapUrl({ name }),
      note: "从任务描述中提取，等待后续接入地理编码精确定位。",
      source: "prompt" as const
    }));

  const seen = new Set<string>();
  const places = [...knownMatches, ...guessed]
    .filter((place) => {
      const key = place.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map((place) => ({
      name: place.name,
      lat: "lat" in place ? place.lat : undefined,
      lon: "lon" in place ? place.lon : undefined,
      region: "region" in place ? place.region : undefined,
      osmUrl: place.osmUrl,
      note: place.note,
      source: place.source
    }));

  if (places.length > 0) return places;

  return ["起点待定", "核心地点待定", "目的地待定"].map((name) => ({
    name,
    osmUrl: openStreetMapUrl({ name }),
    note: "任务中没有明确地点，已保留占位节点。",
    source: "prompt" as const
  }));
}

function mapCsv(places: MapPlace[]) {
  const headers = ["index", "name", "region", "latitude", "longitude", "source", "openstreetmap"];
  return [
    headers.join(","),
    ...places.map((place, index) =>
      [
        String(index + 1),
        place.name,
        place.region ?? "",
        place.lat === undefined ? "" : String(place.lat),
        place.lon === undefined ? "" : String(place.lon),
        place.source,
        place.osmUrl
      ].map(csvEscape).join(",")
    )
  ].join("\n");
}

function mapGeoJson(places: MapPlace[]) {
  return {
    type: "FeatureCollection",
    features: places
      .filter((place) => typeof place.lat === "number" && typeof place.lon === "number")
      .map((place, index) => ({
        type: "Feature",
        properties: {
          index: index + 1,
          name: place.name,
          region: place.region ?? "",
          source: place.source
        },
        geometry: {
          type: "Point",
          coordinates: [place.lon, place.lat]
        }
      }))
  };
}

function coordinateText(place: MapPlace) {
  if (typeof place.lat !== "number" || typeof place.lon !== "number") return "待地理编码";
  return `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`;
}

function mapPlannerHtml(prompt: string, step: string, places: MapPlace[]) {
  const legs = places.slice(1).map((place, index) => ({
    from: places[index].name,
    to: place.name
  }));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ManusXL Map Planner</title>
  <style>
    :root{--ink:#20231f;--muted:#667062;--line:#dce4da;--paper:#fbfcf8;--bg:#eef2ef;--accent:#1d6f5f;--gold:#b98727;--red:#ad4c43}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1080px;margin:0 auto;padding:38px 22px 54px}
    h1{font-size:34px;line-height:1.12;margin:0 0 10px}
    h2{font-size:18px;margin:0 0 14px}
    p{line-height:1.7;color:var(--muted)}
    .grid{display:grid;grid-template-columns:1.15fr .85fr;gap:14px;margin-top:22px}
    section{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:18px}
    .route{display:grid;gap:10px}
    .stop{display:grid;grid-template-columns:36px 1fr auto;gap:12px;align-items:start;border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px}
    .badge{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:#fff;font-weight:800}
    .stop strong{display:block;font-size:16px}.stop small{display:block;margin-top:4px;color:var(--muted)}
    .stop a{color:var(--accent);text-decoration:none;font-weight:700;font-size:12px}
    .legs{display:grid;gap:9px}.leg{display:flex;align-items:center;gap:8px;border:1px dashed var(--line);border-radius:8px;padding:10px;background:#fff}
    .line{height:2px;flex:1;background:linear-gradient(90deg,var(--accent),var(--gold))}
    .mini-map{min-height:280px;display:grid;align-items:end;grid-template-columns:repeat(${Math.max(places.length, 1)},1fr);gap:10px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(180deg,#f7faf5,#e6eee8);padding:16px;overflow:hidden}
    .pin{display:grid;justify-items:center;gap:8px;align-self:end}.dot{width:18px;height:18px;border-radius:50%;background:var(--red);box-shadow:0 0 0 7px rgba(173,76,67,.14)}
    .pin span{max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--ink)}
    pre{white-space:pre-wrap;line-height:1.7;color:var(--ink);margin:0}
    @media(max-width:760px){.grid{grid-template-columns:1fr}.stop{grid-template-columns:32px 1fr}.stop a{grid-column:2}.mini-map{grid-template-columns:1fr;align-items:start}.pin{justify-items:start;grid-template-columns:24px 1fr}.dot{width:14px;height:14px}}
  </style>
</head>
<body>
  <main>
    <h1>ManusXL Map Planner</h1>
    <p>${htmlEscape(prompt)}</p>
    <div class="grid">
      <section>
        <h2>地点顺序</h2>
        <div class="route">
          ${places
            .map(
              (place, index) => `<article class="stop"><div class="badge">${index + 1}</div><div><strong>${htmlEscape(place.name)}</strong><small>${htmlEscape(place.note)} · ${coordinateText(place)}</small></div><a href="${htmlEscape(place.osmUrl)}">OpenStreetMap</a></article>`
            )
            .join("")}
        </div>
      </section>
      <section>
        <h2>路线段</h2>
        <div class="legs">
          ${
            legs.length > 0
              ? legs
                  .map(
                    (leg) => `<div class="leg"><strong>${htmlEscape(leg.from)}</strong><span class="line"></span><strong>${htmlEscape(leg.to)}</strong></div>`
                  )
                  .join("")
              : "<p>当前只有一个地点，适合做周边探索或单城行程。</p>"
          }
        </div>
      </section>
      <section>
        <h2>地图草图</h2>
        <div class="mini-map">
          ${places
            .map((place) => `<div class="pin"><i class="dot"></i><span>${htmlEscape(place.name)}</span></div>`)
            .join("")}
        </div>
      </section>
      <section>
        <h2>执行说明</h2>
        <pre>${htmlEscape(step)}</pre>
      </section>
    </div>
  </main>
</body>
</html>`;
}

async function runMapPlanner(input: AgentToolInput): Promise<AgentToolResult> {
  const places = extractMapPlaces(input.prompt, input.step);
  const legs = places.slice(1).map((place, index) => ({
    from: places[index].name,
    to: place.name
  }));
  const geojson = mapGeoJson(places);
  const planJson = JSON.stringify(
    {
      taskId: input.taskId,
      prompt: input.prompt,
      step: input.step,
      generatedAt: new Date().toISOString(),
      places,
      legs,
      notes: [
        "当前版本使用内置地点坐标和 OpenStreetMap 链接生成地图式交付物。",
        "未命中内置坐标的地点会保留为待地理编码节点，后续可接入真实地图 API。"
      ]
    },
    null,
    2
  );
  const csv = mapCsv(places);
  const html = mapPlannerHtml(input.prompt, input.step, places);
  const geoJsonContent = JSON.stringify(geojson, null, 2);
  const { tmp } = await ensureTaskWorkspace(input.taskId, input.ownerId);

  await writeFile(join(tmp, "map-plan.json"), planJson);
  await writeFile(join(tmp, "map-places.csv"), csv);
  await writeFile(join(tmp, "map-itinerary.html"), html);
  if (geojson.features.length > 0) {
    await writeFile(join(tmp, "map-places.geojson"), geoJsonContent);
  }

  return {
    toolName: "map_planner",
    ok: true,
    observation: `已生成地图路线规划：识别 ${places.length} 个地点、${legs.length} 段路线，并准备 HTML/JSON/CSV 交付物。`,
    payload: {
      places,
      legs,
      generatedArtifacts: [
        {
          name: "map-itinerary.html",
          type: "html",
          mimeType: "text/html; charset=utf-8",
          content: html
        },
        {
          name: "map-plan.json",
          type: "json",
          mimeType: "application/json; charset=utf-8",
          content: planJson
        },
        {
          name: "map-places.csv",
          type: "csv",
          mimeType: "text/csv; charset=utf-8",
          content: csv
        },
        ...(geojson.features.length > 0
          ? [
              {
                name: "map-places.geojson",
                type: "json",
                mimeType: "application/geo+json; charset=utf-8",
                content: geoJsonContent
              }
            ]
          : [])
      ]
    }
  };
}

async function runDataAnalysis(input: AgentToolInput): Promise<AgentToolResult> {
  const dimensions = ["目标", "资料", "分析", "交付", "风险"];
  return {
    toolName: "data_analysis",
    ok: true,
    observation: `已按 ${dimensions.join(" / ")} 五个维度整理当前步骤，形成可进入报告和表格的数据结构。`,
    payload: {
      dimensions,
      rows: dimensions.map((dimension, index) => ({
        dimension,
        priority: index < 3 ? "P0" : "P1",
        note: `${dimension}：${input.step}`
      }))
    }
  };
}

async function runChartGenerator(input: AgentToolInput): Promise<AgentToolResult> {
  const { tmp } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const outputPath = join(tmp, "chart-spec.json");
  const chartTypes = ["line", "bar", "pie", "scatter", "heatmap"];
  const spec = {
    title: input.step,
    chartTypes,
    series: input.plan.map((step, index) => ({
      label: `步骤 ${index + 1}`,
      name: step,
      value: (index + 1) * 12
    }))
  };
  await writeFile(outputPath, JSON.stringify(spec, null, 2));

  return {
    toolName: "chart_generator",
    ok: true,
    observation: "已生成 5 类图表规格：line、bar、pie、scatter、heatmap，任务交付物会包含交互式 HTML 与 5 张 PNG 图表。",
    payload: {
      outputPath,
      chartTypes,
      outputFormats: ["html", "png"],
      chartSpec: spec
    }
  };
}

async function runArtifactWriter(input: AgentToolInput): Promise<AgentToolResult> {
  return {
    toolName: "artifact_writer",
    ok: true,
    observation: "已准备多格式交付物生成上下文，任务结束时会生成 Markdown、CSV、XLSX、PPTX、PDF、HTML 和 ZIP。",
    payload: {
      sourceStep: input.step,
      formats: ["md", "csv", "xlsx", "pptx", "pdf", "html", "zip"]
    }
  };
}

export function pickTool(step: string, index: number, enabledTools?: AgentToolName[]): AgentToolName {
  const candidates = inferToolsForStep(step);
  candidates.push(["task_planner", "web_research", "data_analysis", "artifact_writer"][index % 4] as AgentToolName);

  if (!enabledTools || enabledTools.length === 0) return candidates[0];
  return candidates.find((tool) => enabledTools.includes(tool)) ?? enabledTools[index % enabledTools.length];
}

export async function executeAgentTool(
  toolName: AgentToolName,
  input: AgentToolInput
): Promise<AgentToolResult> {
  const forcedFailure = input.failureOverrides?.[toolName];
  if (forcedFailure) {
    return {
      toolName,
      ok: false,
      observation: `诊断模拟失败：${forcedFailure}`,
      payload: {
        diagnosticFailure: {
          toolName,
          reason: forcedFailure
        }
      }
    };
  }

  switch (toolName) {
    case "task_planner":
      return runTaskPlanner(input);
    case "web_research":
      return runWebResearch(input);
    case "web_fetch":
      return runWebFetch(input);
    case "local_browser":
      return runLocalBrowser(input);
    case "my_computer":
      return runMyComputer(input);
    case "file_reader":
      return runFileReader(input);
    case "file_workspace":
      return runFileWorkspace(input);
    case "batch_file_ops":
      return runBatchFileOps(input);
    case "batch_image_process":
      return runBatchImageProcess(input);
    case "image_ocr":
      return runImageOcr(input);
    case "skill_runner":
      return runSkillRunner(input);
    case "python_execute":
      return runPythonExecute(input);
    case "shell_execute":
      return runShellExecute(input);
    case "mcp_call":
      return runMcpCall(input);
    case "data_analysis":
      return runDataAnalysis(input);
    case "map_planner":
      return runMapPlanner(input);
    case "chart_generator":
      return runChartGenerator(input);
    case "artifact_writer":
      return runArtifactWriter(input);
  }
}

export async function executeAgentToolWithFallback(
  toolName: AgentToolName,
  input: AgentToolInput,
  enabledTools?: AgentToolName[]
) {
  const metadata = toolMetadataByName.get(toolName);
  const fallbackTools = (metadata?.fallbackTools ?? []).filter((tool) =>
    enabledTools ? enabledTools.includes(tool) : true
  );
  const chain = uniqueTools([toolName, ...fallbackTools]).slice(0, 3);
  const attempts: NonNullable<AgentToolResult["attempts"]> = [];

  for (const candidate of chain) {
    const result = await executeAgentTool(candidate, input);
    attempts.push({
      toolName: candidate,
      ok: result.ok,
      observation: result.observation
    });

    if (result.ok) {
      const usedFallback = candidate !== toolName;
      return {
        ...result,
        attempts,
        usedFallback,
        observation: usedFallback
          ? `主工具 ${toolName} 不可用，已降级使用 ${candidate}。${result.observation}`
          : result.observation,
        payload: {
          ...result.payload,
          fallback: {
            requestedTool: toolName,
            resolvedTool: candidate,
            attempts
          }
        }
      };
    }
  }

  const lastAttempt = attempts.at(-1);
  return {
    toolName,
    ok: false,
    observation: `工具链全部失败：${attempts
      .map((attempt) => `${attempt.toolName}=${attempt.ok ? "ok" : "failed"}`)
      .join(" → ")}。请考虑换路径执行该步骤。`,
    payload: {
      fallback: {
        requestedTool: toolName,
        resolvedTool: null,
        attempts,
        lastObservation: lastAttempt?.observation
      }
    },
    attempts,
    usedFallback: attempts.length > 1
  } satisfies AgentToolResult;
}
