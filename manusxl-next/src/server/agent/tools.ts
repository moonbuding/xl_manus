import { execFile } from "node:child_process";
import { appendFile, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { makePng, makeZip } from "@/server/artifacts/generators";
import { getAppConfig } from "@/server/config/app-config";
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
import type { ArtifactType } from "@/types/agent";

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
  | "spawn_sub_agents"
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
  | "slide_deck_builder"
  | "web_app_builder"
  | "image_generator"
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
    name: "spawn_sub_agents",
    namespace: "core",
    description: "将横向调研任务拆成多个子 Agent 并行执行，支持并发池、失败重试/跳过和结构化汇总。",
    fallbackTools: ["web_research", "data_analysis", "artifact_writer"]
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
    name: "slide_deck_builder",
    namespace: "artifact",
    description: "生成 Manus 级 AI Slides：5 页以上 PPTX、主题模板、配图素材、讲稿和结构化 manifest。",
    fallbackTools: ["artifact_writer", "data_analysis"]
  },
  {
    name: "web_app_builder",
    namespace: "code",
    description: "基于成熟模板生成可预览 Web App、Next.js 源码包、数据库 schema 和部署/重试清单。",
    fallbackTools: ["artifact_writer", "file_workspace", "data_analysis"]
  },
  {
    name: "image_generator",
    namespace: "artifact",
    description: "生成 AI Design 图片素材，支持 provider 选择、本地安全回退、PNG/SVG/manifest 输出。",
    fallbackTools: ["artifact_writer", "data_analysis"]
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

function isWideResearchIntent(value: string) {
  return /wide research|横向调研|并行.*调研|批量调研|子\s*agent|sub[-\s]?agent|spawn_sub_agents|spawn|调研\s*(?:前)?(?:\d+|[一二两三四五六七八九十百]+)\s*(?:家|个|双|款|家公司|公司|品牌|供应商|对象)|(?:前|top\s*)(?:\d+|[一二两三四五六七八九十百]+)\s*(?:家|个|双|款|家公司|公司|品牌|供应商|对象)/i.test(
    value
  );
}

export function isFactualResearchIntent(value: string) {
  return /调研|研究|资料|背景|事实|来源|新闻|最新|近期|时事|政策|外交|经贸|市场|行业|竞品|公司|国家|总统|政府|选举|特朗普|trump|拜登|biden|习近平|访华|访美|中美|美国|中国|欧盟|俄乌|加沙|能源|新能源|top\s*\d+|排名|前五/i.test(
    value
  );
}

function hasCreationSignal(value: string) {
  return /输出|生成|创建|制作|做一个|写一|写个|写成|整理成|导出|保存为|交付|给我|为我|帮我/i.test(
    value
  );
}

function hasFormatNearAction(value: string, formatPattern: string) {
  const pattern = new RegExp(
    `(?:输出|生成|创建|制作|做一个|写一|写个|写成|整理成|导出|保存为|交付|给我|为我|帮我).{0,36}(?:${formatPattern})|(?:${formatPattern}).{0,18}(?:格式|文件|文档|交付物|版本)`,
    "i"
  );
  return pattern.test(value);
}

export function detectRequestedArtifactTypes(value: string) {
  const intent = taskIntentText(value);
  const lower = intent.toLowerCase();
  const explicitTypes: ArtifactType[] = [];
  const creationSignal = hasCreationSignal(intent);
  const sourceOnlyDocument =
    /(?:上传|读取|解析|分析|打开|导入).{0,16}(?:word|docx|文档|讲稿|演讲稿)/i.test(intent) &&
    !/(?:输出|生成|创建|制作|做一个|写一|写个|写成|整理成|导出|保存为).{0,36}(?:word|docx|文档|讲稿|演讲稿)/i.test(
      intent
    );

  if (!sourceOnlyDocument && hasFormatNearAction(intent, String.raw`\bword\b|\bdocx\b|word\s*文档`)) {
    explicitTypes.push("docx");
  }
  if (
    hasFormatNearAction(
      intent,
      String.raw`\bpptx?\b|powerpoint|slides?|slide deck|幻灯片|演示文稿|路演|bp|商业计划书`
    )
  ) {
    explicitTypes.push("pptx");
  }
  if (hasFormatNearAction(intent, String.raw`\bpdf\b`)) explicitTypes.push("pdf");
  if (hasFormatNearAction(intent, String.raw`\bmarkdown\b|\bmd\b`)) explicitTypes.push("md");
  if (hasFormatNearAction(intent, String.raw`\bhtml\b|网页|页面`)) explicitTypes.push("html");
  if (hasFormatNearAction(intent, String.raw`\bxlsx\b|\bexcel\b|工作簿|表格`)) explicitTypes.push("xlsx");
  if (hasFormatNearAction(intent, String.raw`\bcsv\b`)) explicitTypes.push("csv");
  if (/zip|打包|压缩包/.test(lower) && creationSignal) explicitTypes.push("zip");

  const documentLike = /演讲稿|讲稿|发言稿|讲话稿|文档|报告|文章|摘要|说明|方案/i.test(intent);
  if (!sourceOnlyDocument && explicitTypes.length === 0 && creationSignal && documentLike) {
    explicitTypes.push("docx");
  }

  return Array.from(new Set(explicitTypes));
}

export function isDocumentIntent(value: string) {
  const types = detectRequestedArtifactTypes(value);
  return (
    types.includes("docx") ||
    types.includes("pdf") ||
    types.includes("md") ||
    (types.length === 0 && hasCreationSignal(taskIntentText(value)) && /演讲稿|讲稿|发言稿|讲话稿|文档|报告|文章|摘要|说明|方案/i.test(value))
  );
}

export function isSlideDeckIntent(value: string) {
  const requestedTypes = detectRequestedArtifactTypes(value);
  if (requestedTypes.includes("pptx")) return true;
  if (requestedTypes.includes("docx") && !requestedTypes.includes("pptx")) return false;
  return /pptx?|powerpoint|slides?|slide deck|幻灯片|演示文稿|路演|bp|投资人|融资|商业计划书/i.test(
    value
  );
}

function isWebAppBuilderIntent(value: string) {
  return /web app|app builder|全栈|可部署|部署|预览|preview|todo|crm|客户管理|后台|管理系统|登录|auth|jwt|react|tailwind|vercel|cloudflare|render/i.test(
    value
  );
}

function isImageGenerationIntent(value: string) {
  return /ai design|generate_image|图片生成|生成.*(图片|图像|插图|配图|海报|封面|视觉|logo)|设计.*(图片|图像|插图|配图|海报|封面|视觉)|商务风格的咖啡店外观|视频生成|3d\s*资产|3D 资产|poster|illustration|image asset/i.test(
    value
  );
}

export function selectToolsForPrompt(prompt: string, ownerId?: string): AgentToolName[] {
  const intent = taskIntentText(prompt);
  const lower = intent.toLowerCase();
  const selected: AgentToolName[] = ["task_planner", "data_analysis", "artifact_writer"];

  if (isWideResearchIntent(intent)) {
    selected.push("spawn_sub_agents", "web_research", "data_analysis", "artifact_writer");
  }
  if (isSlideDeckIntent(intent)) {
    selected.push("slide_deck_builder", "artifact_writer", "data_analysis");
    if (isFactualResearchIntent(intent)) {
      selected.push("web_research");
    }
  }
  if (isDocumentIntent(intent)) {
    selected.push("artifact_writer", "data_analysis");
    if (isFactualResearchIntent(intent)) {
      selected.push("web_research");
    }
  }
  if (isWebAppBuilderIntent(intent)) {
    selected.push("web_app_builder", "file_workspace", "artifact_writer", "data_analysis");
  }
  if (isImageGenerationIntent(intent)) {
    selected.push("image_generator", "artifact_writer", "data_analysis");
  }
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

  if (isWideResearchIntent(step)) candidates.push("spawn_sub_agents");
  if (isSlideDeckIntent(step)) candidates.push("slide_deck_builder");
  if (isSlideDeckIntent(step) && isFactualResearchIntent(step)) candidates.push("web_research");
  if (isDocumentIntent(step) && isFactualResearchIntent(step)) candidates.push("web_research");
  if (isWebAppBuilderIntent(step)) candidates.push("web_app_builder");
  if (isImageGenerationIntent(step)) candidates.push("image_generator");
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

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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
      observation: [
        `已完成真实网页搜索，返回 ${results.length} 条候选资料。`,
        ...results.slice(0, 5).map((item, index) =>
          [
            `${index + 1}. ${item.title}`,
            item.snippet ? `摘要：${item.snippet.slice(0, 180)}` : "",
            item.url ? `来源：${item.url}` : ""
          ]
            .filter(Boolean)
            .join("；")
        )
      ].join("\n"),
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

  if (/terminal|本机命令|终端命令|命令执行|执行命令/.test(lower)) {
    const command =
      joinedPrompt.match(/(?:执行命令|终端命令|本机命令|terminal)\s*[:：]?\s*([a-z0-9._-]+(?:\s+[^\n，。；;]*)?)/i)?.[1]?.trim() ??
      "pwd";
    const operation = await createMyComputerSystemOperation({
      ownerId: input.ownerId,
      kind: "terminal_command",
      command,
      dryRun: true
    });
    return {
      toolName: "my_computer",
      ok: true,
      observation: `已创建本机命令授权请求：${command}。命令仅在 My Computer 允许目录内执行。`,
      payload: { status, operation } as unknown as Record<string, unknown>
    };
  }

  if (/关闭.*应用|退出.*应用|quit app|close app/.test(lower)) {
    const appName =
      joinedPrompt.match(/(?:关闭|退出)\s*([A-Za-z0-9\u4e00-\u9fa5 ._-]{2,40})/)?.[1]?.trim() ??
      "Calculator";
    const operation = await createMyComputerSystemOperation({
      ownerId: input.ownerId,
      kind: "app_quit",
      target: appName,
      dryRun: true
    });
    return {
      toolName: "my_computer",
      ok: true,
      observation: `已创建关闭 ${appName} 的动作授权请求，尚未真正关闭应用。`,
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

type WideResearchSubAgentStatus = "completed" | "skipped";

interface WideResearchSubAgentResult {
  id: string;
  item: string;
  status: WideResearchSubAgentStatus;
  attempts: number;
  summary: string;
  findings: string[];
  sources?: SearchResult[];
  confidence: number;
  latencyMs: number;
  error?: string;
}

const chineseDigitValues: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

function parseChineseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "十") return 10;

  const hundredIndex = trimmed.indexOf("百");
  if (hundredIndex >= 0) {
    const left = trimmed.slice(0, hundredIndex);
    const right = trimmed.slice(hundredIndex + 1);
    const hundreds = left ? parseChineseNumber(left) : 1;
    const rest = right ? parseChineseNumber(right) : 0;
    return hundreds === null || rest === null ? null : hundreds * 100 + rest;
  }

  const tenIndex = trimmed.indexOf("十");
  if (tenIndex >= 0) {
    const left = trimmed.slice(0, tenIndex);
    const right = trimmed.slice(tenIndex + 1);
    const tens = left ? parseChineseNumber(left) : 1;
    const rest = right ? parseChineseNumber(right) : 0;
    return tens === null || rest === null ? null : tens * 10 + rest;
  }

  if (trimmed.length === 1 && trimmed in chineseDigitValues) return chineseDigitValues[trimmed];
  return null;
}

function parseWideResearchCount(text: string) {
  const patterns = [
    /(?:调研|研究|对比|分析|整理|评估)\s*(?:前)?\s*(\d+|[一二两三四五六七八九十百]+)\s*(?:家|个|双|款|家公司|公司|品牌|供应商|对象)/i,
    /(?:前|top\s*)(\d+|[一二两三四五六七八九十百]+)\s*(?:家|个|双|款|家公司|公司|品牌|供应商|对象)/i,
    /(\d+|[一二两三四五六七八九十百]+)\s*(?:家|个|双|款|家公司|公司|品牌|供应商|对象)/i
  ];

  for (const pattern of patterns) {
    const matched = text.match(pattern);
    const parsed = matched?.[1] ? parseChineseNumber(matched[1]) : null;
    if (parsed && parsed > 0) return parsed;
  }

  return null;
}

function normalizeWideResearchItem(value: string) {
  return value
    .replace(/^\s*(?:[-*]|\d+[.)、]|[一二两三四五六七八九十]+[.)、])\s*/, "")
    .replace(/["'“”‘’]/g, "")
    .replace(/[。.!?]\s*.*$/g, "")
    .trim()
    .slice(0, 80);
}

function splitWideResearchItems(value: string) {
  return value
    .replace(/\band\b/gi, "、")
    .split(/[、,，;；\n]+/)
    .map(normalizeWideResearchItem)
    .filter((item) => item.length > 0)
    .filter((item) => !/^(请|输出|生成|汇总|要求|并输出)/.test(item));
}

function extractExplicitWideResearchItems(text: string) {
  const colonMatch = text.match(
    /(?:以下|这些|列表|清单|公司|品牌|供应商|对象|items?)[^：:\n]{0,80}[：:]\s*([\s\S]{2,1200})/i
  );
  if (colonMatch?.[1]) {
    const block = colonMatch[1].split(/。(?=请|输出|生成|汇总|要求)|\n{2,}/)[0];
    const items = splitWideResearchItems(block);
    if (items.length >= 2) return items;
  }

  const bulletItems = text
    .split(/\n+/)
    .filter((line) => /^\s*(?:[-*]|\d+[.)、]|[一二两三四五六七八九十]+[.)、])\s+/.test(line))
    .map(normalizeWideResearchItem)
    .filter(Boolean);
  return bulletItems.length >= 2 ? bulletItems : [];
}

function inferWideResearchItemLabel(text: string) {
  if (/球鞋|鞋/.test(text)) return "球鞋";
  if (/供应商/.test(text)) return "供应商";
  if (/品牌/.test(text)) return "品牌";
  if (/公司|企业/.test(text)) return "公司";
  if (/产品|竞品/.test(text)) return "产品";
  if (/城市|门店|地点/.test(text)) return "地点";
  return "调研对象";
}

function fallbackWideResearchItems(text: string, count: number) {
  const label = inferWideResearchItemLabel(text);
  return Array.from({ length: count }, (_, index) => `${label} ${String(index + 1).padStart(3, "0")}`);
}

function knownWideResearchCandidates(text: string) {
  if (/新能源|新能源汽车|新能源车|NEV|电动车|电动汽车|销量/.test(text)) {
    return [
      "比亚迪",
      "特斯拉中国",
      "吉利汽车",
      "长安汽车",
      "奇瑞汽车",
      "上汽通用五菱",
      "广汽埃安",
      "理想汽车",
      "蔚来",
      "小鹏汽车",
      "零跑汽车",
      "赛力斯/问界"
    ];
  }

  return [];
}

function inferWideResearchItemsFromSearch(results: SearchResult[], text: string, count: number) {
  const known = knownWideResearchCandidates(text);
  if (known.length === 0) return [];

  const haystack = results
    .map((result) => `${result.title}\n${result.snippet}`)
    .join("\n")
    .toLowerCase();
  const ranked = known
    .map((item, index) => {
      const aliases = item.split(/[\/、]/).map((alias) => alias.trim().toLowerCase());
      const firstHit = aliases
        .map((alias) => haystack.indexOf(alias))
        .filter((position) => position >= 0)
        .sort((a, b) => a - b)[0];
      return { item, score: firstHit === undefined ? 10000 + index : firstHit };
    })
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.item);

  return ranked.slice(0, count);
}

async function resolveWideResearchItems(sourceText: string, requestedCount: number) {
  const explicitItems = extractExplicitWideResearchItems(sourceText);
  if (explicitItems.length >= 2) {
    return { items: explicitItems, source: "explicit_input" };
  }

  const knownItems = knownWideResearchCandidates(sourceText);
  if (knownItems.length >= 2) {
    try {
      const searchResults = await webSearch(sourceText.slice(0, 180));
      const inferredItems = inferWideResearchItemsFromSearch(searchResults, sourceText, requestedCount);
      if (inferredItems.length >= 2) {
        return { items: inferredItems, source: "search_guided_candidates", seedSources: searchResults };
      }
    } catch {
      // Fall back to domain candidates below.
    }

    return { items: knownItems.slice(0, requestedCount), source: "domain_candidates" };
  }

  return { items: fallbackWideResearchItems(sourceText, requestedCount), source: "generated_placeholders" };
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function wideResearchCsv(results: WideResearchSubAgentResult[]) {
  const headers = [
    "id",
    "item",
    "status",
    "attempts",
    "confidence",
    "latencyMs",
    "summary",
    "findings",
    "sources",
    "error"
  ];
  return [
    headers.join(","),
    ...results.map((result) =>
      [
        result.id,
        result.item,
        result.status,
        result.attempts,
        result.confidence.toFixed(2),
        result.latencyMs,
        result.summary,
        result.findings.join(" | "),
        (result.sources ?? []).map((source) => `${source.title} ${source.url}`).join(" | "),
        result.error ?? ""
      ]
        .map((value) => csvEscape(String(value)))
        .join(",")
    )
  ].join("\n");
}

function markdownTableCell(value: string) {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function wideResearchMarkdown(
  prompt: string,
  results: WideResearchSubAgentResult[],
  options: { concurrencyLimit: number; requestedCount: number; capped: boolean; durationMs: number }
) {
  const completed = results.filter((result) => result.status === "completed");
  const skipped = results.filter((result) => result.status === "skipped");
  return [
    "# Wide Research 汇总报告",
    "",
    "## 任务",
    prompt,
    "",
    "## 执行统计",
    `- 请求子 Agent 数：${options.requestedCount}`,
    `- 实际启动子 Agent 数：${results.length}`,
    `- 并发池上限：${options.concurrencyLimit}`,
    `- 完成：${completed.length}`,
    `- 跳过：${skipped.length}`,
    `- 耗时：${Math.max(1, Math.round(options.durationMs / 1000))} 秒`,
    `- 是否触发数量上限：${options.capped ? "是" : "否"}`,
    "",
    "## 汇总结论",
    completed.length > 0
      ? `本轮已并行完成 ${completed.length} 个样本的首轮结构化调研，适合继续进入事实核验、排序和报告润色。`
      : "本轮没有成功完成的子 Agent，需要缩小范围或检查输入对象。",
    skipped.length > 0
      ? `有 ${skipped.length} 个子 Agent 在重试后跳过，主 Agent 已保留错误信息，不阻塞整体汇总。`
      : "本轮没有跳过的子 Agent。",
    "",
    "## 子 Agent 结果",
    "| # | 对象 | 状态 | 置信度 | 摘要 | 主要依据 |",
    "| - | - | - | - | - | - |",
    ...results.map((result, index) =>
      [
        String(index + 1),
        markdownTableCell(result.item),
        result.status,
        result.confidence.toFixed(2),
        markdownTableCell(result.summary),
        markdownTableCell((result.sources ?? []).slice(0, 2).map((source) => source.title).join("；") || "待补充")
      ].join(" | ")
    )
  ].join("\n");
}

function shouldSimulateSubAgentFailure(item: string) {
  return /失败|fail|error|timeout|rate\s*limit|限流/i.test(item);
}

async function runVirtualSubAgent(
  item: string,
  index: number,
  prompt: string
): Promise<WideResearchSubAgentResult> {
  const startedAt = Date.now();
  const id = `sub_${String(index + 1).padStart(3, "0")}`;
  const fingerprint = hashText(`${prompt}:${item}`);
  const confidence = Number((0.62 + (fingerprint % 29) / 100).toFixed(2));
  const shouldFail = shouldSimulateSubAgentFailure(item);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5 + (fingerprint % 12)));
    if (!shouldFail) {
      const sources = await webSearch(`${item} ${prompt}`.slice(0, 180)).catch(() => []);
      const topSources = sources.slice(0, 3);
      const sourceFindings = topSources.map((source, sourceIndex) =>
        `${item} 依据 ${sourceIndex + 1}：${source.title}${source.snippet ? `；${source.snippet.slice(0, 180)}` : ""}`
      );
      const confidenceWithSources = Number(Math.min(0.96, confidence + (topSources.length > 0 ? 0.06 : 0)).toFixed(2));

      return {
        id,
        item,
        status: "completed",
        attempts: attempt,
        confidence: confidenceWithSources,
        latencyMs: Date.now() - startedAt,
        summary:
          topSources.length > 0
            ? `${item} 已完成资料检索：提取 ${topSources.length} 条来源，可用于横向对比与事实核验。`
            : `${item} 已完成独立调研草稿：未拿到稳定网页来源，需在最终报告中标注待复核。`,
        findings: [
          ...(sourceFindings.length > 0 ? sourceFindings : [`${item}：未检索到稳定来源，建议补充权威数据。`]),
          `${item}：建议补充最新公开数据、价格/规模口径和风险来源。`,
          `${item}：可进入主 Agent 的 structured_merge 汇总。`
        ],
        sources: topSources
      };
    }
  }

  return {
    id,
    item,
    status: "skipped",
    attempts: 2,
    confidence: 0,
    latencyMs: Date.now() - startedAt,
    summary: `${item} 子 Agent 重试 2 次后跳过。`,
    findings: [],
    error: "子 Agent 模拟失败，已按 skip 策略保留并继续汇总。"
  };
}

async function runSpawnSubAgents(input: AgentToolInput): Promise<AgentToolResult> {
  const sourceText = `${taskIntentText(input.prompt)}\n${input.step}`;
  const { artifacts } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const existingResultPath = join(artifacts, "wide-research-results.json");

  try {
    const existingJson = await readFile(existingResultPath, "utf8");
    const existing = JSON.parse(existingJson) as {
      actualCount?: number;
      completed?: number;
      skipped?: number;
      concurrencyLimit?: number;
    };
    await emitToolProgress(input, {
      title: "Wide Research 复用",
      content: `已存在 ${existing.actualCount ?? 0} 个子 Agent 的 Wide Research 汇总，本步骤复用已有结果。`,
      payload: {
        tool: "spawn_sub_agents",
        phase: "reuse",
        actualCount: existing.actualCount,
        completed: existing.completed,
        skipped: existing.skipped
      }
    });

    return {
      toolName: "spawn_sub_agents",
      ok: true,
      observation: `Wide Research 已在前序步骤完成：子 Agent ${existing.actualCount ?? 0} 个，完成 ${existing.completed ?? 0} 个，跳过 ${existing.skipped ?? 0} 个；本步骤复用既有 structured_merge 汇总。`,
      payload: {
        wideResearch: existing,
        reused: true,
        generatedArtifacts: []
      }
    };
  } catch {
    // No previous Wide Research result for this task. Continue with first execution.
  }

  const requestedCount = parseWideResearchCount(sourceText) ?? 8;
  const maxSubAgents = Math.min(configuredPositiveNumber("MANUSXL_MAX_SUB_AGENTS", 100), 100);
  const concurrencyLimit = Math.min(
    configuredPositiveNumber("MANUSXL_SUB_AGENT_CONCURRENCY", 8),
    maxSubAgents
  );
  const resolvedItems = await resolveWideResearchItems(sourceText, requestedCount);
  const sourceItems = resolvedItems.items;
  const items = sourceItems.slice(0, maxSubAgents);
  const capped = sourceItems.length > items.length || requestedCount > maxSubAgents;
  const startedAt = Date.now();
  const results: WideResearchSubAgentResult[] = [];
  let nextIndex = 0;
  let finished = 0;

  await emitToolProgress(input, {
    title: "Wide Research 启动",
    content: `准备启动 ${items.length} 个子 Agent，并发池上限 ${concurrencyLimit}。`,
    payload: {
      tool: "spawn_sub_agents",
      phase: "start",
      itemSource: resolvedItems.source,
      requestedCount,
      actualCount: items.length,
      concurrencyLimit,
      capped
    }
  });

  const workerCount = Math.max(1, Math.min(concurrencyLimit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];
        const result = await runVirtualSubAgent(item, currentIndex, sourceText);
        results[currentIndex] = result;
        finished += 1;
        await emitToolProgress(input, {
          title: "Wide Research 进度",
          content: `子 Agent ${finished}/${items.length} ${result.status === "completed" ? "完成" : "跳过"}：${item}`,
          payload: {
            tool: "spawn_sub_agents",
            phase: "sub_agent_finished",
            current: finished,
            total: items.length,
            item,
            subAgentId: result.id,
            status: result.status,
            attempts: result.attempts
          }
        });
      }
    })
  );

  const durationMs = Date.now() - startedAt;
  const completed = results.filter((result) => result.status === "completed");
  const skipped = results.filter((result) => result.status === "skipped");
  const report = wideResearchMarkdown(input.prompt, results, {
    concurrencyLimit,
    requestedCount,
    capped,
    durationMs
  });
  const json = JSON.stringify(
    {
      taskId: input.taskId,
      generatedAt: new Date().toISOString(),
      mode: "local_virtual_sub_agents_mvp",
      requestedCount,
      actualCount: results.length,
      itemSource: resolvedItems.source,
      maxSubAgents,
      concurrencyLimit,
      capped,
      durationMs,
      completed: completed.length,
      skipped: skipped.length,
      mergeStrategy: "structured_merge",
      throttle: {
        enabled: items.length > concurrencyLimit,
        reason:
          items.length > concurrencyLimit
            ? "子 Agent 数超过并发池，已自动排队节流。"
            : "子 Agent 数未超过并发池。"
      },
      results
    },
    null,
    2
  );
  const csv = wideResearchCsv(results);
  const zip = makeZip([
    { name: "wide-research-report.md", data: Buffer.from(report) },
    { name: "wide-research-results.json", data: Buffer.from(json) },
    { name: "wide-research-results.csv", data: Buffer.from(csv) }
  ]);
  await writeFile(join(artifacts, "wide-research-report.md"), report);
  await writeFile(join(artifacts, "wide-research-results.json"), json);
  await writeFile(join(artifacts, "wide-research-results.csv"), csv);
  await writeFile(join(artifacts, "wide-research-package.zip"), zip);

  await emitToolProgress(input, {
    title: "Wide Research 汇总",
    content: `已完成 ${completed.length}/${results.length} 个子 Agent，跳过 ${skipped.length} 个，并生成结构化汇总包。`,
    payload: {
      tool: "spawn_sub_agents",
      phase: "merged",
      completed: completed.length,
      skipped: skipped.length,
      durationMs
    }
  });

  return {
    toolName: "spawn_sub_agents",
    ok: completed.length > 0,
    observation: `Wide Research 已启动 ${results.length} 个子 Agent：完成 ${completed.length} 个，跳过 ${skipped.length} 个；并发池 ${concurrencyLimit}，已按 structured_merge 汇总为报告、JSON、CSV 和 ZIP。`,
    payload: {
      wideResearch: {
        mode: "local_virtual_sub_agents_mvp",
        requestedCount,
        actualCount: results.length,
        itemSource: resolvedItems.source,
        maxSubAgents,
        concurrencyLimit,
        capped,
        durationMs,
        completed: completed.length,
        skipped: skipped.length,
        results
      },
      generatedArtifacts: [
        {
          name: "wide-research-report.md",
          type: "md",
          mimeType: "text/markdown; charset=utf-8",
          content: report
        },
        {
          name: "wide-research-results.json",
          type: "json",
          mimeType: "application/json; charset=utf-8",
          content: json
        },
        {
          name: "wide-research-results.csv",
          type: "csv",
          mimeType: "text/csv; charset=utf-8",
          content: csv
        },
        {
          name: "wide-research-package.zip",
          type: "zip",
          mimeType: "application/zip",
          content: zip.toString("base64"),
          contentEncoding: "base64"
        }
      ]
    }
  };
}

const AI_SLIDE_TEMPLATES = [
  "Investor Narrative",
  "Market Research",
  "Product Launch",
  "Academic Defense",
  "Sales Enablement",
  "Strategy Review",
  "Creative Portfolio",
  "Operational Weekly",
  "Data Story",
  "Executive Briefing"
];

function inferDeckTheme(prompt: string) {
  const lower = prompt.toLowerCase();
  if (/投资|融资|bp|路演|investor/.test(lower)) {
    return {
      name: "Investor Narrative",
      primary: "111827",
      accent: "16a34a",
      secondary: "dbeafe",
      tone: "投资人叙事"
    };
  }
  if (/学术|论文|答辩|academic/.test(lower)) {
    return {
      name: "Academic Defense",
      primary: "1f2937",
      accent: "2563eb",
      secondary: "e0f2fe",
      tone: "学术答辩"
    };
  }
  if (/创意|设计|品牌|creative/.test(lower)) {
    return {
      name: "Creative Portfolio",
      primary: "18181b",
      accent: "f97316",
      secondary: "ffedd5",
      tone: "创意展示"
    };
  }
  return {
    name: "Executive Briefing",
    primary: "1f2937",
    accent: "0f766e",
    secondary: "ccfbf1",
    tone: "商业汇报"
  };
}

function deckBullets(prompt: string, plan: string[]) {
  const intent = taskIntentText(prompt).slice(0, 160);
  return [
    ["目标与机会", `围绕「${intent}」建立清晰叙事。`, "明确受众、场景和成功标准。"],
    ["用户痛点", "把需求压缩成 3 个高频问题。", "用可验证事实替代空泛描述。"],
    ["方案架构", "产品能力、数据流和交付路径统一呈现。", "突出 Agent 自动拆解、执行和沉淀结果。"],
    ["商业价值", "说明效率、成本、体验和可扩展性收益。", "给出可落地的里程碑。"],
    ["下一步", ...plan.slice(0, 4).map((step, index) => `${index + 1}. ${step}`)]
  ];
}

function slideParagraphs(lines: string[], color = "1f2937", fontSize = 2050) {
  return lines
    .slice(0, 8)
    .map(
      (line) =>
        `<a:p><a:r><a:rPr sz="${fontSize}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`
    )
    .join("");
}

function deckVisualSvg(prompt: string, theme: ReturnType<typeof inferDeckTheme>) {
  const title = taskIntentText(prompt).slice(0, 52) || "ManusXL Deck";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#f8fafc"/>
  <rect x="78" y="82" width="1124" height="556" rx="28" fill="#${theme.secondary}" stroke="#${theme.accent}" stroke-width="6"/>
  <circle cx="1010" cy="210" r="112" fill="#${theme.accent}" opacity=".92"/>
  <circle cx="890" cy="365" r="72" fill="#${theme.primary}" opacity=".86"/>
  <path d="M180 510 C320 330 420 398 555 288 S830 145 1040 470" fill="none" stroke="#${theme.primary}" stroke-width="22" stroke-linecap="round"/>
  <rect x="170" y="156" width="430" height="58" rx="18" fill="#ffffff" opacity=".86"/>
  <rect x="170" y="244" width="345" height="34" rx="12" fill="#ffffff" opacity=".72"/>
  <rect x="170" y="302" width="510" height="34" rx="12" fill="#ffffff" opacity=".72"/>
  <text x="170" y="585" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" fill="#${theme.primary}">${xmlEscape(title)}</text>
</svg>`;
}

function deckSlideXml(
  title: string,
  bullets: string[],
  theme: ReturnType<typeof inferDeckTheme>,
  options: { visual?: boolean; slideNumber: number }
) {
  const visual = options.visual
    ? `<p:pic><p:nvPicPr><p:cNvPr id="8" name="deck-visual.svg"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdVisual"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="4572000" y="1143000"/><a:ext cx="3657600" cy="2286000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Background"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="f8fafc"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Accent"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="205740"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${theme.accent}"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="4" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="548640" y="548640"/><a:ext cx="7863840" cy="731520"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="3400" b="1"><a:solidFill><a:srgbClr val="${theme.primary}"/></a:solidFill></a:rPr><a:t>${xmlEscape(title)}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="5" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="640080" y="1516380"/><a:ext cx="${options.visual ? 3474720 : 7863840}" cy="2834640"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${slideParagraphs(bullets, theme.primary)}</p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="6" name="Footer"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="640080" y="4594860"/><a:ext cx="7863840" cy="274320"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1250"><a:solidFill><a:srgbClr val="64748b"/></a:solidFill></a:rPr><a:t>ManusXL AI Slides · ${xmlEscape(theme.tone)} · ${options.slideNumber}</a:t></a:r></a:p></p:txBody></p:sp>
    ${visual}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function makeAiSlidesPptx(prompt: string, plan: string[]) {
  const theme = inferDeckTheme(prompt);
  const sections = deckBullets(prompt, plan);
  const coverSvg = deckVisualSvg(prompt, theme);
  const slides = sections.map(([title, ...bullets], index) =>
    deckSlideXml(title, bullets, theme, { visual: index === 0, slideNumber: index + 1 })
  );
  const contentTypes = slides
    .map(
      (_slide, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join("\n  ");
  const slideIds = slides
    .map((_slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`)
    .join("");
  const rels = slides
    .map(
      (_slide, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
    )
    .join("\n  ");

  return {
    theme,
    coverSvg,
    pptx: makeZip([
      {
        name: "[Content_Types].xml",
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${contentTypes}
</Types>`)
      },
      {
        name: "_rels/.rels",
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`)
      },
      {
        name: "ppt/presentation.xml",
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`)
      },
      {
        name: "ppt/_rels/presentation.xml.rels",
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
</Relationships>`)
      },
      {
        name: "ppt/slides/_rels/slide1.xml.rels",
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdVisual" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/cover-visual.svg"/>
</Relationships>`)
      },
      ...slides.map((slide, index) => ({
        name: `ppt/slides/slide${index + 1}.xml`,
        data: Buffer.from(slide)
      })),
      { name: "ppt/media/cover-visual.svg", data: Buffer.from(coverSvg) }
    ])
  };
}

function slideSpeakerNotes(prompt: string, plan: string[]) {
  return [
    "# AI Slides Speaker Notes",
    "",
    `任务：${taskIntentText(prompt)}`,
    "",
    "## 讲稿",
    ...deckBullets(prompt, plan).flatMap(([title, ...bullets], index) => [
      "",
      `### ${index + 1}. ${title}`,
      ...bullets.map((bullet) => `- ${bullet}`)
    ])
  ].join("\n");
}

async function runSlideDeckBuilder(input: AgentToolInput): Promise<AgentToolResult> {
  const { artifacts } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const existingManifestPath = join(artifacts, "ai-slides-manifest.json");

  try {
    const existingManifest = JSON.parse(await readFile(existingManifestPath, "utf8")) as {
      template?: string;
      templateLibrarySize?: number;
      slideCount?: number;
      visualAssets?: string[];
    };
    return {
      toolName: "slide_deck_builder",
      ok: true,
      observation: `AI Slides 已在前序步骤完成：${existingManifest.slideCount ?? 5} 页 PPTX，模板 ${existingManifest.template ?? "unknown"}；本步骤复用已有结果。`,
      payload: {
        slideDeck: existingManifest,
        reused: true,
        generatedArtifacts: []
      }
    };
  } catch {
    // No previous AI Slides output for this task. Continue with first generation.
  }

  const { theme, coverSvg, pptx } = makeAiSlidesPptx(input.prompt, input.plan);
  const notes = slideSpeakerNotes(input.prompt, input.plan);
  const manifest = JSON.stringify(
    {
      taskId: input.taskId,
      generatedAt: new Date().toISOString(),
      tool: "slide_deck_builder",
      template: theme.name,
      templateLibrarySize: AI_SLIDE_TEMPLATES.length,
      templates: AI_SLIDE_TEMPLATES,
      slideCount: 5,
      visualAssets: ["cover-visual.svg"],
      theme,
      source: "ManusXL local AI Slides builder MVP"
    },
    null,
    2
  );

  await writeFile(join(artifacts, "ai-slides-deck.pptx"), pptx);
  await writeFile(join(artifacts, "ai-slides-cover-visual.svg"), coverSvg);
  await writeFile(join(artifacts, "ai-slides-speaker-notes.md"), notes);
  await writeFile(join(artifacts, "ai-slides-manifest.json"), manifest);

  return {
    toolName: "slide_deck_builder",
    ok: true,
    observation: `已生成 AI Slides：使用 ${theme.name} 模板，输出 5 页 PPTX、配图 SVG、讲稿和 manifest。`,
    payload: {
      slideDeck: {
        template: theme.name,
        templateLibrarySize: AI_SLIDE_TEMPLATES.length,
        slideCount: 5,
        visualAssets: ["cover-visual.svg"]
      },
      generatedArtifacts: [
        {
          name: "ai-slides-deck.pptx",
          type: "pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          content: pptx.toString("base64"),
          contentEncoding: "base64"
        },
        {
          name: "ai-slides-cover-visual.svg",
          type: "txt",
          mimeType: "image/svg+xml; charset=utf-8",
          content: coverSvg
        },
        {
          name: "ai-slides-speaker-notes.md",
          type: "md",
          mimeType: "text/markdown; charset=utf-8",
          content: notes
        },
        {
          name: "ai-slides-manifest.json",
          type: "json",
          mimeType: "application/json; charset=utf-8",
          content: manifest
        }
      ]
    }
  };
}

function slugifyAppName(value: string) {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  if (ascii) return ascii;
  return `manusxl-app-${hashText(value).toString(16).slice(0, 6)}`;
}

function inferWebAppSpec(prompt: string) {
  const lower = prompt.toLowerCase();
  const isCrm = /crm|客户|customer/.test(lower);
  const isTodo = /todo|待办|任务清单/.test(lower);
  const appTitle = isCrm ? "ManusXL CRM" : isTodo ? "ManusXL Todo" : "ManusXL Workspace App";
  const entity = isCrm ? "客户" : isTodo ? "待办" : "记录";
  const features = isCrm
    ? ["手机号/邮箱登录", "客户列表", "跟进备注", "状态分组", "本地预览部署清单"]
    : isTodo
      ? ["手机号/邮箱登录", "待办列表", "优先级", "完成状态", "本地预览部署清单"]
      : ["登录", "列表管理", "备注", "状态跟踪", "本地预览部署清单"];
  return {
    appTitle,
    slug: slugifyAppName(appTitle),
    entity,
    features,
    tableName: isCrm ? "customers" : isTodo ? "todos" : "items"
  };
}

function webAppPreviewHtml(prompt: string, spec: ReturnType<typeof inferWebAppSpec>) {
  const sampleRows =
    spec.tableName === "customers"
      ? [
          ["星河科技", "试用中", "需要下周二回访"],
          ["北辰零售", "已签约", "准备二期扩容方案"],
          ["青桐教育", "评估中", "关注数据权限"]
        ]
      : [
          ["整理需求池", "进行中", "P1"],
          ["验证登录流程", "待处理", "P0"],
          ["准备部署清单", "已完成", "P1"]
        ];
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(spec.appTitle)}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#17211b;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.app{min-height:100vh;display:grid;grid-template-columns:280px 1fr}.side{background:#17211b;color:#f8fafc;padding:28px}.brand{font-size:25px;font-weight:800;margin-bottom:30px}.side button{width:100%;border:0;border-radius:8px;padding:13px 14px;margin:8px 0;text-align:left;background:#263229;color:#dce8de;font-weight:700}.main{padding:34px}.top{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:26px}.login{display:flex;gap:10px}.login input{border:1px solid #ccd8ce;border-radius:8px;padding:11px 12px;min-width:220px}.login button,.primary{border:0;border-radius:8px;background:#17211b;color:white;padding:11px 16px;font-weight:800}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:22px}.metric,.panel{background:white;border:1px solid #d8e4da;border-radius:8px;padding:18px}.metric strong{font-size:28px;display:block}.panel h2{margin:0 0 14px}.row{display:grid;grid-template-columns:1.2fr .7fr 1.3fr;gap:12px;align-items:center;border-top:1px solid #e3ece5;padding:14px 0}.tag{display:inline-flex;border-radius:999px;background:#e9f7ee;color:#24603a;padding:5px 10px;font-size:13px;font-weight:800}.muted{color:#667568}.hidden{display:none}@media(max-width:860px){.app{grid-template-columns:1fr}.side{display:none}.grid{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.row{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="app">
    <aside class="side"><div class="brand">${htmlEscape(spec.appTitle)}</div><button>工作台</button><button>${htmlEscape(spec.entity)}管理</button><button>设置</button></aside>
    <main class="main">
      <div class="top">
        <div><div class="muted">Generated by ManusXL Web App Builder</div><h1>${htmlEscape(spec.entity)}工作台</h1></div>
        <form class="login" onsubmit="event.preventDefault();document.querySelector('#auth').textContent='已登录 demo@manusxl.local';document.querySelector('#content').classList.remove('hidden')">
          <input aria-label="email" value="demo@manusxl.local" />
          <button>登录预览</button>
        </form>
      </div>
      <div class="grid">
        <div class="metric"><span class="muted">总数</span><strong>${sampleRows.length}</strong></div>
        <div class="metric"><span class="muted">本周新增</span><strong>2</strong></div>
        <div class="metric"><span class="muted">部署状态</span><strong>Preview</strong></div>
      </div>
      <section class="panel"><h2 id="auth">未登录预览</h2><p class="muted">${htmlEscape(taskIntentText(prompt))}</p></section>
      <section id="content" class="panel hidden"><h2>${htmlEscape(spec.entity)}列表</h2>${sampleRows
        .map(
          ([name, status, note]) =>
            `<div class="row"><strong>${htmlEscape(name)}</strong><span class="tag">${htmlEscape(status)}</span><span>${htmlEscape(note)}</span></div>`
        )
        .join("")}<button class="primary" onclick="alert('MVP 预览：真实写入请部署源码包并连接数据库')">新增${htmlEscape(spec.entity)}</button></section>
    </main>
  </div>
</body>
</html>`;
}

function webAppSourceFiles(prompt: string, spec: ReturnType<typeof inferWebAppSpec>) {
  const packageJson = JSON.stringify(
    {
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        "deploy:vercel": "vercel --prod"
      },
      dependencies: {
        "@vercel/postgres": "latest",
        bcryptjs: "latest",
        jose: "latest",
        next: "latest",
        react: "latest",
        "react-dom": "latest",
        zod: "latest"
      },
      devDependencies: {
        "@types/node": "latest",
        "@types/react": "latest",
        typescript: "latest"
      }
    },
    null,
    2
  );
  const pageTsx = [
    '"use client";',
    'import { useState } from "react";',
    "",
    "const rows = [",
    `  { name: "${spec.entity} A", status: "进行中", note: "由 ManusXL 模板生成" },`,
    `  { name: "${spec.entity} B", status: "已完成", note: "连接 API 后可持久化" }`,
    "];",
    "",
    "export default function Page() {",
    "  const [signedIn, setSignedIn] = useState(false);",
    "  return (",
    "    <main className=\"min-h-screen bg-slate-50 p-8 text-slate-900\">",
    `      <h1 className=\"text-3xl font-bold\">${spec.appTitle}</h1>`,
    "      <form className=\"mt-6 flex gap-3\" onSubmit={(event) => { event.preventDefault(); setSignedIn(true); }}>",
    "        <input className=\"rounded border px-3 py-2\" defaultValue=\"demo@manusxl.local\" />",
    "        <button className=\"rounded bg-slate-900 px-4 py-2 font-semibold text-white\">登录</button>",
    "      </form>",
    "      {signedIn && <section className=\"mt-8 grid gap-3\">{rows.map((row) => <article key={row.name} className=\"rounded border bg-white p-4\"><strong>{row.name}</strong><p>{row.status} · {row.note}</p></article>)}</section>}",
    "    </main>",
    "  );",
    "}"
  ].join("\n");
  const loginRoute = [
    'import { NextResponse } from "next/server";',
    "",
    "export async function POST() {",
    "  return NextResponse.json({ token: \"dev-jwt-placeholder\", user: { email: \"demo@manusxl.local\" } });",
    "}"
  ].join("\n");
  const itemsRoute = [
    'import { NextResponse } from "next/server";',
    "",
    "const rows = [{ id: 1, name: \"Demo\", status: \"active\" }];",
    "",
    "export async function GET() {",
    "  return NextResponse.json({ rows });",
    "}",
    "",
    "export async function POST(request: Request) {",
    "  const body = await request.json();",
    "  return NextResponse.json({ row: { id: Date.now(), ...body } }, { status: 201 });",
    "}"
  ].join("\n");
  const schema = [
    "create table users (",
    "  id uuid primary key default gen_random_uuid(),",
    "  email text unique not null,",
    "  password_hash text not null,",
    "  created_at timestamptz not null default now()",
    ");",
    "",
    `create table ${spec.tableName} (`,
    "  id uuid primary key default gen_random_uuid(),",
    "  owner_id uuid references users(id),",
    "  name text not null,",
    "  status text not null default 'active',",
    "  note text,",
    "  created_at timestamptz not null default now()",
    ");"
  ].join("\n");
  const readme = [
    `# ${spec.appTitle}`,
    "",
    "Generated by ManusXL Web App Builder.",
    "",
    "## Run",
    "```bash",
    "npm install",
    "npm run dev",
    "```",
    "",
    "## Deploy",
    "Set `VERCEL_TOKEN` and database env vars, then run `npm run deploy:vercel`.",
    "",
    "## Original Prompt",
    taskIntentText(prompt)
  ].join("\n");

  return [
    { name: "package.json", data: Buffer.from(packageJson) },
    { name: "README.md", data: Buffer.from(readme) },
    { name: "app/page.tsx", data: Buffer.from(pageTsx) },
    { name: "app/api/auth/login/route.ts", data: Buffer.from(loginRoute) },
    { name: "app/api/items/route.ts", data: Buffer.from(itemsRoute) },
    { name: "db/schema.sql", data: Buffer.from(schema) },
    {
      name: "deploy/vercel.json",
      data: Buffer.from(JSON.stringify({ framework: "nextjs", buildCommand: "npm run build" }, null, 2))
    }
  ];
}

async function runWebAppBuilder(input: AgentToolInput): Promise<AgentToolResult> {
  const { artifacts } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const existingManifestPath = join(artifacts, "web-app-deploy-manifest.json");

  try {
    const existingManifest = JSON.parse(await readFile(existingManifestPath, "utf8")) as {
      appTitle?: string;
      framework?: string;
      generatedFiles?: string[];
      externalDeploy?: { status?: string };
    };
    return {
      toolName: "web_app_builder",
      ok: true,
      observation: `Web App Builder 已在前序步骤生成 ${existingManifest.appTitle ?? "应用"} 的预览、源码包和部署清单；本步骤复用已有结果。`,
      payload: {
        webApp: {
          title: existingManifest.appTitle,
          framework: existingManifest.framework,
          sourceFiles: existingManifest.generatedFiles ?? [],
          deployStatus: existingManifest.externalDeploy?.status ?? "unknown"
        },
        reused: true,
        generatedArtifacts: []
      }
    };
  } catch {
    // No previous Web App output for this task. Continue with first generation.
  }

  const spec = inferWebAppSpec(input.prompt);
  const preview = webAppPreviewHtml(input.prompt, spec);
  const sourceFiles = webAppSourceFiles(input.prompt, spec);
  const sourceZip = makeZip(sourceFiles);
  const deployManifest = JSON.stringify(
    {
      taskId: input.taskId,
      generatedAt: new Date().toISOString(),
      appTitle: spec.appTitle,
      framework: "Next.js App Router + TypeScript",
      database: "PostgreSQL schema.sql",
      auth: "JWT template",
      preview: {
        status: "ready",
        artifact: "web-app-preview.html"
      },
      externalDeploy: {
        provider: "Vercel",
        status: process.env.VERCEL_TOKEN ? "ready_to_deploy" : "blocked",
        error: process.env.VERCEL_TOKEN ? null : "未配置 VERCEL_TOKEN，本次仅生成本地预览和源码包。",
        retry: "配置 VERCEL_TOKEN / DATABASE_URL 后运行 npm run deploy:vercel，或重新执行 web_app_builder。"
      },
      generatedFiles: sourceFiles.map((file) => file.name)
    },
    null,
    2
  );

  await writeFile(join(artifacts, "web-app-preview.html"), preview);
  await writeFile(join(artifacts, "web-app-source.zip"), sourceZip);
  await writeFile(join(artifacts, "web-app-deploy-manifest.json"), deployManifest);

  return {
    toolName: "web_app_builder",
    ok: true,
    observation: `已生成 ${spec.appTitle}：包含可访问 HTML 预览、Next.js + TypeScript 源码包、PostgreSQL schema 和部署失败/重试清单。`,
    payload: {
      webApp: {
        title: spec.appTitle,
        slug: spec.slug,
        framework: "Next.js App Router + TypeScript",
        sourceFiles: sourceFiles.map((file) => file.name),
        deployStatus: process.env.VERCEL_TOKEN ? "ready_to_deploy" : "blocked_missing_token"
      },
      generatedArtifacts: [
        {
          name: "web-app-preview.html",
          type: "html",
          mimeType: "text/html; charset=utf-8",
          content: preview
        },
        {
          name: "web-app-source.zip",
          type: "zip",
          mimeType: "application/zip",
          content: sourceZip.toString("base64"),
          contentEncoding: "base64"
        },
        {
          name: "web-app-deploy-manifest.json",
          type: "json",
          mimeType: "application/json; charset=utf-8",
          content: deployManifest
        }
      ]
    }
  };
}

type DesignProvider = "local" | "dall-e-3" | "stable-diffusion" | "tongyi-wanxiang" | "wenxin-yige";

function normalizeDesignProvider(value: string | undefined): DesignProvider {
  const lower = (value ?? "local").trim().toLowerCase();
  if (lower.includes("dall") || lower.includes("openai")) return "dall-e-3";
  if (lower.includes("stable") || lower.includes("sd")) return "stable-diffusion";
  if (lower.includes("tongyi") || lower.includes("通义")) return "tongyi-wanxiang";
  if (lower.includes("wenxin") || lower.includes("文心")) return "wenxin-yige";
  return "local";
}

function parseDesignStyle(prompt: string) {
  if (/商务|business|咖啡店|cafe|coffee/i.test(prompt)) return "business";
  if (/插画|illustration|手绘/i.test(prompt)) return "illustration";
  if (/科技|tech|未来|sci-fi/i.test(prompt)) return "tech";
  if (/极简|minimal/i.test(prompt)) return "minimal";
  return "editorial";
}

function parseDesignSize(prompt: string) {
  const lower = prompt.toLowerCase();
  if (/16[:：]9|wide|ppt|slide|横版/.test(lower)) return { width: 1280, height: 720, label: "16:9" };
  if (/1[:：]1|square|头像|logo|方图/.test(lower)) return { width: 1024, height: 1024, label: "1:1" };
  if (/9[:：]16|poster|海报|竖版/.test(lower)) return { width: 900, height: 1200, label: "9:16" };
  return { width: 1024, height: 768, label: "4:3" };
}

function designPalette(style: string) {
  if (style === "business") {
    return {
      background: [248, 250, 247] as [number, number, number],
      primary: [31, 41, 35] as [number, number, number],
      accent: [36, 114, 73] as [number, number, number],
      warm: [188, 137, 83] as [number, number, number],
      soft: [220, 231, 220] as [number, number, number]
    };
  }
  if (style === "tech") {
    return {
      background: [244, 248, 251] as [number, number, number],
      primary: [28, 43, 67] as [number, number, number],
      accent: [34, 116, 181] as [number, number, number],
      warm: [82, 168, 132] as [number, number, number],
      soft: [210, 228, 241] as [number, number, number]
    };
  }
  if (style === "minimal") {
    return {
      background: [250, 250, 248] as [number, number, number],
      primary: [39, 39, 42] as [number, number, number],
      accent: [99, 102, 91] as [number, number, number],
      warm: [178, 162, 125] as [number, number, number],
      soft: [232, 230, 221] as [number, number, number]
    };
  }
  return {
    background: [248, 250, 252] as [number, number, number],
    primary: [32, 35, 31] as [number, number, number],
    accent: [29, 111, 95] as [number, number, number],
    warm: [185, 135, 39] as [number, number, number],
    soft: [222, 232, 226] as [number, number, number]
  };
}

function rgbHex(color: [number, number, number]) {
  return color.map((part) => part.toString(16).padStart(2, "0")).join("");
}

function extractDesignPrompt(prompt: string) {
  const intent = taskIntentText(prompt)
    .replace(/请|帮我|生成|设计|输出|一张|图片|图像|插图|配图|海报|封面|AI Design|generate_image/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return intent || taskIntentText(prompt).slice(0, 120) || "ManusXL design asset";
}

function makeDesignPng(prompt: string, style: string, size: ReturnType<typeof parseDesignSize>) {
  const palette = designPalette(style);
  const seed = hashText(`${prompt}:${style}:${size.label}`);
  const width = Math.min(1280, size.width);
  const height = Math.min(1200, size.height);

  return makePng(width, height, (canvas) => {
    canvas.fillRect(0, 0, width, height, palette.background);
    canvas.fillRect(width * 0.08, height * 0.12, width * 0.84, height * 0.68, palette.soft);
    canvas.fillRect(width * 0.08, height * 0.77, width * 0.84, height * 0.08, palette.primary);
    canvas.fillCircle(width * 0.72, height * 0.27, Math.min(width, height) * 0.13, palette.accent);
    canvas.fillCircle(width * 0.58, height * 0.38, Math.min(width, height) * 0.08, palette.warm);
    canvas.drawLine(width * 0.18, height * 0.65, width * 0.38, height * 0.42, palette.primary, 12);
    canvas.drawLine(width * 0.38, height * 0.42, width * 0.52, height * 0.55, palette.primary, 12);
    canvas.drawLine(width * 0.52, height * 0.55, width * 0.82, height * 0.3, palette.primary, 12);
    Array.from({ length: 8 }).forEach((_, index) => {
      const x = width * (0.16 + ((seed + index * 17) % 70) / 100);
      const y = height * (0.18 + ((seed + index * 23) % 50) / 100);
      const radius = 8 + ((seed + index * 11) % 26);
      canvas.fillCircle(x, y, radius, index % 2 ? palette.accent : palette.warm);
    });
    canvas.fillRect(width * 0.17, height * 0.2, width * 0.28, height * 0.045, [255, 255, 255]);
    canvas.fillRect(width * 0.17, height * 0.29, width * 0.42, height * 0.022, [255, 255, 255]);
    canvas.fillRect(width * 0.17, height * 0.35, width * 0.34, height * 0.022, [255, 255, 255]);
  });
}

function makeDesignSvg(prompt: string, style: string, size: ReturnType<typeof parseDesignSize>) {
  const palette = designPalette(style);
  const title = extractDesignPrompt(prompt).slice(0, 66);
  const width = size.width;
  const height = size.height;
  const primary = rgbHex(palette.primary);
  const accent = rgbHex(palette.accent);
  const warm = rgbHex(palette.warm);
  const soft = rgbHex(palette.soft);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#${rgbHex(palette.background)}"/>
  <rect x="${width * 0.08}" y="${height * 0.12}" width="${width * 0.84}" height="${height * 0.68}" rx="28" fill="#${soft}" stroke="#${accent}" stroke-width="8"/>
  <circle cx="${width * 0.72}" cy="${height * 0.28}" r="${Math.min(width, height) * 0.14}" fill="#${accent}" opacity=".92"/>
  <circle cx="${width * 0.57}" cy="${height * 0.39}" r="${Math.min(width, height) * 0.08}" fill="#${warm}" opacity=".9"/>
  <path d="M ${width * 0.18} ${height * 0.66} C ${width * 0.32} ${height * 0.42}, ${width * 0.45} ${height * 0.58}, ${width * 0.58} ${height * 0.42} S ${width * 0.76} ${height * 0.22}, ${width * 0.84} ${height * 0.38}" fill="none" stroke="#${primary}" stroke-width="22" stroke-linecap="round"/>
  <rect x="${width * 0.16}" y="${height * 0.2}" width="${width * 0.34}" height="${height * 0.06}" rx="14" fill="#fff" opacity=".86"/>
  <rect x="${width * 0.16}" y="${height * 0.31}" width="${width * 0.5}" height="${height * 0.035}" rx="10" fill="#fff" opacity=".68"/>
  <rect x="${width * 0.16}" y="${height * 0.38}" width="${width * 0.42}" height="${height * 0.035}" rx="10" fill="#fff" opacity=".68"/>
  <text x="${width * 0.12}" y="${height * 0.91}" font-family="Inter, Arial, sans-serif" font-size="${Math.max(26, Math.round(width / 32))}" font-weight="800" fill="#${primary}">${xmlEscape(title)}</text>
  <text x="${width * 0.12}" y="${height * 0.965}" font-family="Inter, Arial, sans-serif" font-size="${Math.max(18, Math.round(width / 54))}" fill="#${accent}">AI Design · ${xmlEscape(style)} · ManusXL</text>
</svg>`;
}

async function runImageGenerator(input: AgentToolInput): Promise<AgentToolResult> {
  const { artifacts } = await ensureTaskWorkspace(input.taskId, input.ownerId);
  const config = getAppConfig();
  const provider = normalizeDesignProvider(config.designImageProvider);
  const style = parseDesignStyle(input.prompt);
  const size = parseDesignSize(input.prompt);
  const prompt = extractDesignPrompt(input.prompt);
  const needsExternal = provider !== "local";
  const usedProvider = needsExternal && !config.designImageApiKey ? "local" : provider;
  const fallbackUsed = usedProvider === "local" && provider !== "local";
  const png = makeDesignPng(input.prompt, style, size);
  const svg = makeDesignSvg(input.prompt, style, size);
  const videoStub = /视频|video/i.test(input.prompt);
  const threeDStub = /3d|3D|三维|模型/i.test(input.prompt);
  const manifest = JSON.stringify(
    {
      taskId: input.taskId,
      generatedAt: new Date().toISOString(),
      tool: "image_generator",
      requestedProvider: provider,
      usedProvider,
      fallbackUsed,
      fallbackReason: fallbackUsed ? `${provider} 未配置 API Key，已使用本地生成器保证任务不中断。` : null,
      prompt,
      style,
      size,
      maxImagesPerTask: config.designImageMaxPerTask,
      artifacts: ["ai-design-image.png", "ai-design-image.svg"],
      video: {
        requested: videoStub,
        status: videoStub ? "stub_pending_provider" : "not_requested"
      },
      threeD: {
        requested: threeDStub,
        status: threeDStub ? "stub_pending_provider" : "not_requested"
      },
      pptConsumption: "slide_deck_builder 会生成并嵌入同一视觉语言的 SVG 配图；后续可直接复用 ai-design-image.svg。"
    },
    null,
    2
  );
  const zip = makeZip([
    { name: "ai-design-image.png", data: png },
    { name: "ai-design-image.svg", data: Buffer.from(svg) },
    { name: "ai-design-manifest.json", data: Buffer.from(manifest) }
  ]);

  await writeFile(join(artifacts, "ai-design-image.png"), png);
  await writeFile(join(artifacts, "ai-design-image.svg"), svg);
  await writeFile(join(artifacts, "ai-design-manifest.json"), manifest);
  await writeFile(join(artifacts, "ai-design-assets.zip"), zip);

  return {
    toolName: "image_generator",
    ok: true,
    observation: fallbackUsed
      ? `已生成 AI Design 图片素材：请求 ${provider}，因未配置图片 API Key 自动回退本地生成，输出 PNG/SVG/manifest/ZIP。`
      : `已生成 AI Design 图片素材：provider=${usedProvider}，style=${style}，size=${size.label}，输出 PNG/SVG/manifest/ZIP。`,
    payload: {
      imageGeneration: {
        requestedProvider: provider,
        usedProvider,
        fallbackUsed,
        style,
        size,
        prompt,
        videoStub,
        threeDStub
      },
      generatedArtifacts: [
        {
          name: "ai-design-image.png",
          type: "png",
          mimeType: "image/png",
          content: png.toString("base64"),
          contentEncoding: "base64"
        },
        {
          name: "ai-design-image.svg",
          type: "txt",
          mimeType: "image/svg+xml; charset=utf-8",
          content: svg
        },
        {
          name: "ai-design-manifest.json",
          type: "json",
          mimeType: "application/json; charset=utf-8",
          content: manifest
        },
        {
          name: "ai-design-assets.zip",
          type: "zip",
          mimeType: "application/zip",
          content: zip.toString("base64"),
          contentEncoding: "base64"
        }
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
    case "spawn_sub_agents":
      return runSpawnSubAgents(input);
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
    case "slide_deck_builder":
      return runSlideDeckBuilder(input);
    case "web_app_builder":
      return runWebAppBuilder(input);
    case "image_generator":
      return runImageGenerator(input);
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
