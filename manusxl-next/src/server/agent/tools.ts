import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { makeZip } from "@/server/artifacts/generators";
import { runSandboxedCommand } from "@/server/sandbox/docker-sandbox";
import { callMcpServerTool, enabledMcpTools, listEnabledMcpServers } from "@/server/mcp/mcp-registry";
import { ensureTaskWorkspace } from "@/server/workspace/task-workspace";

const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
const DEFAULT_TOOL_MAX_BUFFER_BYTES = 1024 * 1024;

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
  | "file_reader"
  | "file_workspace"
  | "batch_file_ops"
  | "python_execute"
  | "shell_execute"
  | "mcp_call"
  | "data_analysis"
  | "chart_generator"
  | "artifact_writer";

export interface AgentToolInput {
  taskId: string;
  ownerId?: string;
  prompt: string;
  step: string;
  stepIndex: number;
  plan: string[];
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

export function selectToolsForPrompt(prompt: string): AgentToolName[] {
  const lower = prompt.toLowerCase();
  const selected: AgentToolName[] = ["task_planner", "data_analysis", "artifact_writer"];

  if (/http|网页|搜索|调研|竞品|市场|news|web|research|browser/.test(lower)) {
    selected.push("web_research", "web_fetch");
  }
  if (/mcp|github|slack|notion|filesystem|外部工具|第三方工具/.test(lower)) {
    selected.push("mcp_call");
  }
  if (/\[上传文件摘要\]|上传|文件|pdf|docx|xlsx|csv|excel|word|图片|image|ocr/.test(lower)) {
    selected.push("file_reader", "file_workspace");
  }
  if (/批量|重命名|分类|移动|查重|压缩|缩放|图片|image|ocr|rename|classify/.test(lower)) {
    selected.push("batch_file_ops", "file_reader", "file_workspace");
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
  if (/上传文件|文件摘要|附件|读取.*(文件|pdf|docx|xlsx|csv|excel|word)|解析.*(文件|pdf|docx|xlsx|csv|excel|word)/.test(lower)) {
    candidates.push("file_reader");
  }
  if (/批量|重命名|分类|移动|查重|图片|image|ocr|rename|classify/.test(lower)) {
    candidates.push("batch_file_ops");
  }
  if (/图表|chart|dashboard|看板|趋势|柱状|折线|饼图|散点|热力/.test(lower)) {
    candidates.push("chart_generator");
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
  if (!summary) {
    return {
      toolName: "file_reader",
      ok: true,
      observation: "当前任务没有检测到已上传文件摘要，文件读取工具暂不需要额外处理。",
      payload: { files: [] }
    };
  }

  const fileCount = (summary.match(/^文件：/gm) ?? []).length;
  return {
    toolName: "file_reader",
    ok: true,
    observation: `已读取 ${fileCount || 1} 个上传文件的解析摘要，并将其作为本轮任务上下文。`,
    payload: {
      fileCount: fileCount || 1,
      summary
    }
  };
}

async function runFileWorkspace(input: AgentToolInput): Promise<AgentToolResult> {
  const { root, tmp, artifacts, memoryFile } = await ensureTaskWorkspace(input.taskId, input.ownerId);

  const notesPath = join(tmp, "agent-notes.md");
  const manifestPath = join(artifacts, "manifest.md");
  const memoryNotePath = memoryFile;
  await writeFile(
    notesPath,
    [`# Agent Notes`, ``, `Task: ${input.prompt}`, ``, `Step: ${input.step}`].join("\n")
  );
  await writeFile(
    manifestPath,
    [`# Artifact Manifest`, ``, `Task ID: ${input.taskId}`, `Created: ${new Date().toISOString()}`].join("\n")
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
    observation: "已创建真实任务工作区，并写入 tmp/agent-notes.md、artifacts/manifest.md 与 memory/agent-memory.md。",
    payload: {
      workspaceRoot: root,
      files: [notesPath, manifestPath, memoryNotePath]
    }
  };
}

async function runBatchFileOps(input: AgentToolInput): Promise<AgentToolResult> {
  const files = extractUploadedFileEntries(input.prompt);
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
    observation: "已生成 5 类图表规格：line、bar、pie、scatter、heatmap，并写入 tmp/chart-spec.json。",
    payload: {
      outputPath,
      chartTypes,
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
  switch (toolName) {
    case "task_planner":
      return runTaskPlanner(input);
    case "web_research":
      return runWebResearch(input);
    case "web_fetch":
      return runWebFetch(input);
    case "file_reader":
      return runFileReader(input);
    case "file_workspace":
      return runFileWorkspace(input);
    case "batch_file_ops":
      return runBatchFileOps(input);
    case "python_execute":
      return runPythonExecute(input);
    case "shell_execute":
      return runShellExecute(input);
    case "mcp_call":
      return runMcpCall(input);
    case "data_analysis":
      return runDataAnalysis(input);
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
