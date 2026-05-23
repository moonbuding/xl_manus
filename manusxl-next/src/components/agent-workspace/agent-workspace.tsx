"use client";

import Image from "next/image";
import {
  Archive,
  Bell,
  BookmarkPlus,
  Bot,
  Brain,
  CheckCircle2,
  CircleStop,
  Clock3,
  Code2,
  Database,
  Download,
  FileArchive,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  Gauge,
  Globe,
  Home,
  Camera,
  Loader2,
  PanelRight,
  Paperclip,
  Play,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import {
  ChangeEvent,
  FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  AgentEvent,
  AgentSkill,
  AnalyzeFileResponse,
  Artifact,
  AuthResponse,
  AuthStatus,
  AuthUser,
  AuditLog,
  AuditVerifyResult,
  BillingSummary,
  ConfigResponse,
  ContextMetricsSummary,
  CreateTaskResponse,
  DatabaseStatus,
  LocalBrowserActionResult,
  LocalBrowserPairingStatus,
  LocalBrowserSafetyState,
  LocalBrowserScreenshot,
  LocalBrowserTab,
  LocalBrowserStatus,
  McpCatalogItem,
  McpServer,
  ModelRouterOptimizerResponse,
  MyComputerDesktopPairingStatus,
  MyComputerFileEntry,
  MyComputerFilePlanMode,
  MyComputerFilePlanResponse,
  MyComputerFileScanResponse,
  MyComputerOperation,
  MyComputerOperationKind,
  MyComputerStatus,
  NotificationLog,
  NotificationSettings,
  Organization,
  OrganizationMembership,
  OrganizationRole,
  ScheduledTask,
  ScheduledTaskRunLog,
  ScheduledTaskKind,
  Task,
  TaskExecutionTarget,
  TaskTemplate,
  TaskStatus,
  UploadedLibraryFile,
  UploadedFileSummary
} from "@/types/agent";

const suggestions = [
  "调研中国新能源车前五，输出对比结论和建议",
  "整理一个 SaaS 产品竞品分析，给出定价和定位建议",
  "把一个复杂需求拆成 PRD、技术方案和任务清单",
  "用 Python 分析 AI Agent 产品 MVP 需求，并生成报告、表格、PPT、PDF 和 ZIP",
  "用 Shell 检查任务 workspace 目录和文件结构，并输出 ZIP 归档",
  "规划东京、京都、大阪 5 日旅行路线，并生成地图式网页"
];

const defaultSkills: AgentSkill[] = [
  {
    id: "builtin-pdf",
    name: "pdf",
    description: "处理 PDF 上传、正文抽取、可读性判断和报告摘要。",
    triggers: ["pdf", "简历", "论文", "合同", "扫描", "报告"],
    toolsRequired: ["file_reader", "artifact_writer"],
    source: "builtin",
    enabled: true,
    validationStatus: "allowed"
  },
  {
    id: "builtin-spreadsheet",
    name: "spreadsheets",
    description: "处理 CSV/XLSX 数据预览、表格分析和 Excel 交付物。",
    triggers: ["excel", "xlsx", "csv", "表格", "数据"],
    toolsRequired: ["file_reader", "data_analysis", "artifact_writer"],
    source: "builtin",
    enabled: true,
    validationStatus: "allowed"
  },
  {
    id: "builtin-documents",
    name: "documents",
    description: "处理 DOCX/Word 文档解析、改写、摘要、批注建议和结构化报告。",
    triggers: ["docx", "word", "文档", "合同", "简历", "改写", "批注"],
    toolsRequired: ["file_reader", "artifact_writer"],
    source: "builtin",
    enabled: true,
    validationStatus: "allowed"
  },
  {
    id: "builtin-presentations",
    name: "presentations",
    description: "把调研、数据分析和方案整理成 PPT/PPTX 大纲、讲稿与演示交付物。",
    triggers: ["ppt", "pptx", "幻灯片", "路演", "汇报", "演示"],
    toolsRequired: ["file_reader", "data_analysis", "artifact_writer"],
    source: "builtin",
    enabled: true,
    validationStatus: "allowed"
  },
  {
    id: "builtin-batch-files",
    name: "batch-files",
    description: "为图片、文档和表格生成批量重命名、分类、移动 dry-run 清单。",
    triggers: ["批量", "重命名", "分类", "图片", "文件整理"],
    toolsRequired: ["batch_file_ops", "file_workspace"],
    source: "builtin",
    enabled: true,
    validationStatus: "allowed"
  },
  {
    id: "builtin-image-tools",
    name: "image-tools",
    description: "处理上传图片的压缩、缩放、格式转换和 OCR 文字识别。",
    triggers: ["图片", "照片", "压缩", "缩放", "OCR", "文字识别", "发票", "名片"],
    toolsRequired: ["batch_image_process", "image_ocr", "file_reader"],
    source: "builtin",
    enabled: true,
    validationStatus: "allowed"
  },
  {
    id: "builtin-maps",
    name: "maps",
    description: "生成地点顺序、路线段、OpenStreetMap 链接和可下载地图式 HTML/JSON 交付物。",
    triggers: ["地图", "路线", "行程", "旅行", "旅游", "地址", "附近", "周边", "map", "route"],
    toolsRequired: ["map_planner", "web_research", "artifact_writer"],
    source: "builtin",
    enabled: true,
    validationStatus: "allowed"
  },
  {
    id: "builtin-my-computer",
    name: "my-computer",
    description: "连接本机允许目录，生成文件分类、查重、重命名 dry-run，并创建应用/剪贴板/键鼠授权请求。",
    triggers: ["My Computer", "本机", "本地文件", "Downloads", "剪贴板", "启动应用", "键鼠"],
    toolsRequired: ["my_computer", "file_workspace"],
    source: "builtin",
    enabled: true,
    validationStatus: "allowed"
  }
];

const statusText: Record<TaskStatus, string> = {
  queued: "排队中",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  timeout: "已超时"
};

const organizationRoleText: Record<OrganizationRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer"
};

type NavigationView = "workspace" | "agent" | "library" | "settings";
type AuthMode = "phone" | "email-login" | "email-register";
type MarketplaceSort = "featured" | "popular" | "topRated" | "latest";

interface SandboxStatus {
  mode: string;
  image: string;
  memoryLimit: string;
  cpuLimit: string;
  pidsLimit: string;
  workspaceQuotaBytes: number;
  networkEnabled: boolean;
  poolEnabled: boolean;
  dockerAvailable: boolean;
  imageAvailable: boolean;
  reason?: string;
  pool: Array<{
    containerName: string;
    workspaceRoot: string;
    image: string;
    createdAt: string;
    lastUsedAt: string;
  }>;
}

interface SandboxSelfTestResult {
  ok: boolean;
  scenario?: string;
  workspaceRoot?: string;
  error?: string;
  resourceError?: {
    kind: string;
    message: string;
  };
  python?: {
    sandbox: {
      mode: string;
      fallbackUsed?: boolean;
    };
  };
  shell?: {
    sandbox: {
      mode: string;
      fallbackUsed?: boolean;
    };
  };
}

interface OcrStatus {
  engine: "tesseract";
  available: boolean;
  version?: string;
  languages: string[];
  missingLanguages: string[];
  recommendedLanguages: string[];
  installHint: string;
  reason?: string;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0
  }).format(value);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function formatCny(value: number) {
  return `¥${value.toFixed(value < 0.1 ? 4 : 2)}`;
}

function basenameForUi(pathname: string) {
  return pathname.split(/[\\/]/).filter(Boolean).pop() ?? pathname;
}

async function readJson<T>(response: Response, fallback?: T): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    if (fallback !== undefined) return fallback;
    throw new Error(`服务返回空响应 (${response.status})`);
  }
  return JSON.parse(text) as T;
}

function getErrorMessage(caught: unknown, fallback: string) {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === "string" && caught.trim()) return caught;
  return fallback;
}

function parseDomainAllowlist(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .map((item) => {
          try {
            if (/^https?:\/\//.test(item)) return new URL(item).hostname.toLowerCase();
          } catch {
            return item;
          }
          return item;
        })
        .map((item) => item.replace(/^\*\./, "").replace(/^\.+/, "").replace(/\.+$/, ""))
        .filter((item) => /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(item))
    )
  );
}

function parseFilesystemRoots(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function createOptimisticTask(taskId: string, prompt: string, model: string, status: TaskStatus): Task {
  const now = new Date().toISOString();
  return {
    id: taskId,
    prompt,
    model,
    executionTarget: "cloud",
    status,
    createdAt: now,
    updatedAt: now,
    events: [],
    artifacts: []
  };
}

function getEventIcon(type: AgentEvent["type"]) {
  switch (type) {
    case "thinking":
      return <Brain size={16} />;
    case "plan":
      return <PanelRight size={16} />;
    case "tool_call":
      return <SquareTerminal size={16} />;
    case "tool_result":
      return <Search size={16} />;
    case "artifact":
      return <Archive size={16} />;
    case "finished":
      return <CheckCircle2 size={16} />;
    case "failed":
      return <XCircle size={16} />;
    default:
      return <Bot size={16} />;
  }
}

function getArtifactIcon(type: Artifact["type"]) {
  if (type === "csv" || type === "xlsx") return <FileSpreadsheet size={17} />;
  if (type === "pptx") return <Presentation size={17} />;
  if (type === "pdf") return <FileType size={17} />;
  if (type === "json") return <FileJson size={17} />;
  if (type === "html") return <Code2 size={17} />;
  if (type === "zip") return <FileArchive size={17} />;
  return <FileText size={17} />;
}

function artifactPurpose(artifact: Artifact) {
  const name = artifact.name.toLowerCase();
  if (name === "task-report.md") return "完整 Markdown 报告，适合复制、二次编辑和沉淀到知识库。";
  if (name === "task-data.csv") return "核心结论/数据表，适合导入表格工具继续分析。";
  if (name === "task-analysis.xlsx") return "Excel 工作簿，适合查看结构化结果和继续加工数据。";
  if (name === "task-briefing.pptx") return "汇报用 PPT，适合直接做演示或给团队同步。";
  if (name === "task-summary.pdf") return "便于发送和归档的 PDF 摘要版报告。";
  if (name === "summary.html") return "单页网页报告，适合在浏览器里快速预览。";
  if (name === "dashboard.html") return "可视化看板，用来浏览关键指标、结论和图表。";
  if (name === "chart-gallery.html") return "图表合集页面，集中查看本次任务生成的图片图表。";
  if (name.includes("deliverables.zip")) return "完整交付包，包含本次任务生成的主要文件。";
  if (name.includes("wide-research-report")) return "并行调研汇总报告，说明子任务对象、结论和来源。";
  if (name.includes("wide-research-results.csv")) return "并行调研结果表，适合筛选、排序和二次分析。";
  if (name.includes("wide-research-results.json")) return "机器可读的调研结构化数据，适合开发或自动化处理。";
  if (name.includes("wide-research-package")) return "并行调研结果打包文件，包含报告、表格和 JSON。";
  if (name.includes("agent-trace")) return "技术追踪日志，主要用于排查问题，普通使用通常不需要下载。";
  if (name.startsWith("chart-") && artifact.type === "png") return "可插入报告或 PPT 的图表图片。";
  if (artifact.type === "pdf") return "PDF 文件，适合发送、打印或归档。";
  if (artifact.type === "md") return "Markdown 文档，适合继续编辑。";
  if (artifact.type === "csv") return "CSV 表格数据，适合导入 Excel 或数据库。";
  if (artifact.type === "xlsx") return "Excel 表格，适合业务分析。";
  if (artifact.type === "pptx") return "演示文稿，适合汇报展示。";
  if (artifact.type === "html") return "网页交付物，可在浏览器打开预览。";
  if (artifact.type === "zip") return "打包文件，方便一次性下载。";
  if (artifact.type === "json") return "结构化数据，适合调试或系统集成。";
  return "任务生成的交付文件，可按需下载查看。";
}

function artifactPriority(artifact: Artifact) {
  const name = artifact.name.toLowerCase();
  if (name === "task-report.md") return 10;
  if (name === "task-summary.pdf") return 20;
  if (name === "task-analysis.xlsx") return 30;
  if (name === "task-briefing.pptx") return 40;
  if (name === "task-data.csv") return 50;
  if (name === "summary.html") return 60;
  if (name === "dashboard.html") return 70;
  if (name.includes("deliverables.zip")) return 80;
  if (name.includes("wide-research-report")) return 90;
  if (name.includes("wide-research-results.csv")) return 100;
  if (name.includes("wide-research-results.json")) return 110;
  if (name.includes("wide-research-package")) return 120;
  if (name.startsWith("chart-")) return 130;
  if (name.includes("agent-trace")) return 900;
  return 500;
}

function isUsefulTimelineEvent(event: AgentEvent) {
  if (event.type === "artifact") return false;
  if (event.type === "tool_call") return false;
  const title = event.title ?? "";
  if (
    /任务排队|工具动态启用|模型路由|Context Engineering|Context 指标|Billing|Workspace 清理/.test(
      title
    )
  ) {
    return false;
  }
  return true;
}

function currentTaskStage(task: Task) {
  if (task.status === "completed") return "已完成，结果和交付物已生成。";
  if (task.status === "failed") return "任务失败，请查看执行过程里的失败原因。";
  if (task.status === "cancelled") return "任务已取消。";
  if (task.status === "timeout") return "任务已超时。";
  const latest = [...task.events].reverse().find((event) => event.type !== "artifact");
  return latest ? latest.title ?? latest.content : "正在准备执行。";
}

function mergeTaskEvent(task: Task, event: AgentEvent): Task {
  const exists = task.events.some((item) => item.id === event.id);
  const artifact = extractArtifact(event);
  const nextArtifacts =
    artifact && !task.artifacts.some((item) => item.id === artifact.id)
      ? [...task.artifacts, artifact]
      : task.artifacts;

  return {
    ...task,
    status:
      event.type === "finished"
        ? "completed"
        : event.type === "failed"
          ? task.status === "cancelled" || task.status === "timeout"
            ? task.status
            : "failed"
          : task.status === "queued"
            ? "running"
            : task.status,
    finalAnswer: event.type === "finished" ? event.content : task.finalAnswer,
    events: exists ? task.events : [...task.events, event],
    artifacts: nextArtifacts,
    updatedAt: event.createdAt
  };
}

function extractArtifact(event: AgentEvent) {
  if (event.type !== "artifact") return undefined;
  const payload = event.payload as { artifact?: Artifact } | undefined;
  return payload?.artifact;
}

function buildPromptWithFiles(prompt: string, files: UploadedFileSummary[]) {
  const basePrompt = prompt.trim() || "请阅读并总结我上传的文件。";
  if (files.length === 0) return basePrompt;

  const fileContext = files
    .map(
      (file) =>
        [
          `文件：${file.name}`,
          `类型：${file.extension || file.mimeType}，大小：${formatSize(file.size)}`,
          `摘要：${file.summary}`,
          `正文预览：${file.textPreview || "未抽取到可读文本"}`
        ].join("\n")
    )
    .join("\n\n");

  return `${basePrompt}\n\n[上传文件摘要]\n${fileContext}`;
}

const uploadedFileContextMarker = "[上传文件摘要]";

function getUserVisiblePrompt(value: string) {
  const markerIndex = value.indexOf(uploadedFileContextMarker);
  const visible = markerIndex >= 0 ? value.slice(0, markerIndex) : value;
  return visible.replace(/\s+/g, " ").trim() || "未命名任务";
}

function parsePromptUploadedFiles(value: string) {
  const markerIndex = value.indexOf(uploadedFileContextMarker);
  if (markerIndex < 0) return [];

  return value
    .slice(markerIndex + uploadedFileContextMarker.length)
    .trim()
    .split(/\n(?=文件：)/g)
    .map((block) => {
      const name = block.match(/^文件：(.+)$/m)?.[1]?.trim() ?? "上传文件";
      const meta = block.match(/^类型：(.+)$/m)?.[1]?.trim() ?? "";
      const summaryStart = block.indexOf("摘要：");
      const previewStart = block.indexOf("\n正文预览：");
      const summary =
        summaryStart >= 0
          ? block.slice(summaryStart + "摘要：".length, previewStart >= 0 ? previewStart : undefined).trim()
          : "";
      const preview =
        previewStart >= 0 ? block.slice(previewStart + "\n正文预览：".length).trim() : "";

      return {
        name,
        meta,
        summary,
        preview
      };
    })
    .filter((file) => file.name || file.summary || file.preview)
    .slice(0, 6);
}

function truncateForUi(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function sanitizePayloadForUi(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePayloadForUi);
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? truncateForUi(value) : value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes("prompt")) {
        if (typeof item === "string") {
          const visible = getUserVisiblePrompt(item);
          return [key, item.includes(uploadedFileContextMarker) ? `${visible}（已隐藏上传文件上下文）` : truncateForUi(visible)];
        }
        return [key, "已隐藏"];
      }
      if (
        lowerKey === "content" ||
        lowerKey.includes("preview") ||
        lowerKey.includes("base64") ||
        lowerKey.includes("text")
      ) {
        return [key, typeof item === "string" ? truncateForUi(item, 160) : "已折叠"];
      }
      return [key, sanitizePayloadForUi(item)];
    })
  );
}

function extractTemplateVariables(template: string) {
  const matches = template.matchAll(/\{([\w\u4e00-\u9fa5-]+)\}/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1]))).slice(0, 12);
}

function renderPromptTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{([\w\u4e00-\u9fa5-]+)\}/g, (match, key: string) => {
    const value = values[key]?.trim();
    return value || match;
  });
}

function parseEnvDraft(value: string) {
  return Object.fromEntries(
    value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : [line, ""];
      })
      .filter(([key]) => /^[A-Z_][A-Z0-9_]*$/i.test(key))
  );
}

function extractInvitationToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, "http://manusxl.local");
    return url.searchParams.get("inviteToken") ?? url.searchParams.get("token") ?? trimmed;
  } catch {
    return trimmed;
  }
}

export function AgentWorkspace() {
  const [prompt, setPrompt] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileSummary[]>([]);
  const [libraryFiles, setLibraryFiles] = useState<UploadedLibraryFile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [marketplaceTemplates, setMarketplaceTemplates] = useState<TaskTemplate[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpCatalog, setMcpCatalog] = useState<McpCatalogItem[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditVerify, setAuditVerify] = useState<AuditVerifyResult | null>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [scheduledLogs, setScheduledLogs] = useState<ScheduledTaskRunLog[]>([]);
  const [scheduledMailbox, setScheduledMailbox] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState("");
  const [orgTasks, setOrgTasks] = useState<Task[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrganizationMembership[]>([]);
  const [authDraft, setAuthDraft] = useState({
    phone: "",
    email: "",
    password: "",
    displayName: "",
    verificationCode: ""
  });
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("phone");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isRefreshingAudit, setIsRefreshingAudit] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeNav, setActiveNav] = useState<NavigationView>("workspace");
  const [executionTarget, setExecutionTarget] = useState<TaskExecutionTarget>("cloud");
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [contextMetrics, setContextMetrics] = useState<ContextMetricsSummary | null>(null);
  const [routerOptimizer, setRouterOptimizer] = useState<ModelRouterOptimizerResponse | null>(null);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);
  const [sandboxSelfTest, setSandboxSelfTest] = useState<SandboxSelfTestResult | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus | null>(null);
  const [localBrowserStatus, setLocalBrowserStatus] = useState<LocalBrowserStatus | null>(null);
  const [localBrowserTabs, setLocalBrowserTabs] = useState<LocalBrowserTab[]>([]);
  const [localBrowserScreenshot, setLocalBrowserScreenshot] = useState<LocalBrowserScreenshot | null>(null);
  const [localBrowserActionResult, setLocalBrowserActionResult] = useState<LocalBrowserActionResult | null>(null);
  const [localBrowserSafety, setLocalBrowserSafety] = useState<LocalBrowserSafetyState | null>(null);
  const [localBrowserPairing, setLocalBrowserPairing] = useState<LocalBrowserPairingStatus | null>(null);
  const [myComputerStatus, setMyComputerStatus] = useState<MyComputerStatus | null>(null);
  const [myComputerPairing, setMyComputerPairing] = useState<MyComputerDesktopPairingStatus | null>(null);
  const [myComputerScan, setMyComputerScan] = useState<MyComputerFileScanResponse | null>(null);
  const [myComputerPlan, setMyComputerPlan] = useState<MyComputerFilePlanResponse | null>(null);
  const [myComputerActionResult, setMyComputerActionResult] = useState<MyComputerOperation | null>(null);
  const [myComputerNotice, setMyComputerNotice] = useState<string | null>(null);
  const [myComputerError, setMyComputerError] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus | null>(null);
  const [templateRun, setTemplateRun] = useState<{
    template: TaskTemplate;
    variables: string[];
    values: Record<string, string>;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isForkingTemplate, setIsForkingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskQuery, setTaskQuery] = useState("");
  const [templateTagFilter, setTemplateTagFilter] = useState("all");
  const [marketplaceSort, setMarketplaceSort] = useState<MarketplaceSort>("featured");
  const [settingsDraft, setSettingsDraft] = useState({
    apiKey: "",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    temperature: "0.35",
    maxSteps: "6",
    taskBudgetUsd: "1",
    planningModel: "deepseek-v4-flash",
    executionModel: "deepseek-v4-flash",
    finalModel: "deepseek-v4-flash",
    promptCacheEnabled: true,
    localBrowserDomainAllowlist: "",
    myComputerAllowedRoots: "",
    designImageProvider: "local",
    designImageApiKey: "",
    designImageMaxPerTask: "4"
  });
  const [notificationDraft, setNotificationDraft] = useState({
    emailEnabled: false,
    webhookEnabled: false,
    slackEnabled: false,
    webhookUrl: "",
    slackWebhookUrl: "",
    notifyOnCompleted: true,
    notifyOnFailed: true
  });
  const [scheduledDraft, setScheduledDraft] = useState({
    name: "",
    prompt: "",
    kind: "interval" as ScheduledTaskKind,
    intervalMinutes: "60",
    cronExpression: "0 9 * * 1"
  });
  const [orgDraft, setOrgDraft] = useState({
    name: "",
    taskQuota: "25",
    invitePhone: "",
    inviteRole: "member" as Exclude<OrganizationRole, "owner">,
    acceptToken: ""
  });
  const [orgInviteResult, setOrgInviteResult] = useState<{
    phone: string;
    role: Exclude<OrganizationRole, "owner">;
    acceptUrl: string;
    token: string;
  } | null>(null);
  const [orgAcceptNotice, setOrgAcceptNotice] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isApplyingRouterPolicy, setIsApplyingRouterPolicy] = useState(false);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [isTestingNotifications, setIsTestingNotifications] = useState(false);
  const [isCreatingScheduledTask, setIsCreatingScheduledTask] = useState(false);
  const [isRunningScheduledTask, setIsRunningScheduledTask] = useState(false);
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [isInvitingOrgMember, setIsInvitingOrgMember] = useState(false);
  const [isAcceptingOrgInvite, setIsAcceptingOrgInvite] = useState(false);
  const [managingOrgMemberId, setManagingOrgMemberId] = useState<string | null>(null);
  const [isUploadingSkill, setIsUploadingSkill] = useState(false);
  const [isRunningSandboxTest, setIsRunningSandboxTest] = useState(false);
  const [isCheckingDatabase, setIsCheckingDatabase] = useState(false);
  const [isCheckingLocalBrowser, setIsCheckingLocalBrowser] = useState(false);
  const [isCapturingLocalBrowser, setIsCapturingLocalBrowser] = useState(false);
  const [isRunningLocalBrowserAction, setIsRunningLocalBrowserAction] = useState(false);
  const [isSavingLocalBrowserAllowlist, setIsSavingLocalBrowserAllowlist] = useState(false);
  const [isTogglingLocalBrowserPause, setIsTogglingLocalBrowserPause] = useState(false);
  const [isCreatingLocalBrowserPairing, setIsCreatingLocalBrowserPairing] = useState(false);
  const [isCheckingMyComputer, setIsCheckingMyComputer] = useState(false);
  const [isSavingMyComputer, setIsSavingMyComputer] = useState(false);
  const [isCreatingMyComputerPairing, setIsCreatingMyComputerPairing] = useState(false);
  const [isScanningMyComputer, setIsScanningMyComputer] = useState(false);
  const [isPlanningMyComputer, setIsPlanningMyComputer] = useState(false);
  const [isApprovingMyComputer, setIsApprovingMyComputer] = useState(false);
  const [isUndoingMyComputer, setIsUndoingMyComputer] = useState(false);
  const [isRunningMyComputerAction, setIsRunningMyComputerAction] = useState(false);
  const [localBrowserEndpoint, setLocalBrowserEndpoint] = useState("http://127.0.0.1:9222");
  const [localBrowserActionDraft, setLocalBrowserActionDraft] = useState({
    action: "navigate" as "navigate" | "click" | "type" | "press",
    url: "",
    x: "",
    y: "",
    text: "",
    key: "Enter"
  });
  const [myComputerDraft, setMyComputerDraft] = useState({
    root: "",
    mode: "classify" as MyComputerFilePlanMode,
    actionKind: "app_launch" as Extract<
      MyComputerOperationKind,
      | "app_launch"
      | "app_quit"
      | "clipboard_write"
      | "clipboard_read"
      | "keyboard_shortcut"
      | "mouse_click"
      | "terminal_command"
    >,
    actionTarget: "Calculator",
    actionText: "来自 ManusXL 的剪贴板测试",
    actionCommand: "pwd",
    x: "320",
    y: "240"
  });
  const [isAddingMcp, setIsAddingMcp] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpDraft, setMcpDraft] = useState({
    name: "",
    type: "stdio" as "sse" | "stdio",
    url: "",
    command: "npx",
    args: "",
    env: ""
  });
  const eventSourceRef = useRef<EventSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const skillInputRef = useRef<HTMLInputElement | null>(null);
  const initialTaskParamRef = useRef<string | null>(null);
  const initialInviteTokenRef = useRef<string | null>(null);
  const activeTaskId = activeTask?.id;
  const activeTaskStatus = activeTask?.status;

  const runningTaskCount = useMemo(
    () => tasks.filter((task) => task.status === "running" || task.status === "queued").length,
    [tasks]
  );

  const completedTaskCount = useMemo(
    () => tasks.filter((task) => task.status === "completed").length,
    [tasks]
  );
  const activeOrganization = useMemo(
    () => organizations.find((organization) => organization.id === activeOrgId) ?? null,
    [activeOrgId, organizations]
  );
  const selectedOrgCanCreateTask = !activeOrganization || activeOrganization.role !== "viewer";
  const hasOnlineDesktop = Boolean(
    myComputerStatus?.desktopDevices.some((device) => device.status === "online")
  );
  const showComposer = activeNav === "workspace" || activeNav === "agent";
  const isHomeView = activeNav === "workspace" && !activeTask;

  const visibleTasks = useMemo(() => {
    const normalized = taskQuery.trim().toLowerCase();
    if (!normalized) return tasks;
    return tasks.filter(
      (task) =>
        task.prompt.toLowerCase().includes(normalized) ||
        task.id.toLowerCase().includes(normalized)
    );
  }, [taskQuery, tasks]);

  const templateTags = useMemo(
    () => Array.from(new Set(templates.flatMap((template) => template.tags))).sort(),
    [templates]
  );

  const visibleTemplates = useMemo(() => {
    if (templateTagFilter === "all") return templates;
    return templates.filter((template) => template.tags.includes(templateTagFilter));
  }, [templateTagFilter, templates]);

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const refreshAuthUser = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) {
        setAuthUser(null);
        return null;
      }
      const data = await readJson<AuthResponse>(response);
      setAuthUser(data.user);
      return data.user;
    } catch {
      setAuthUser(null);
      return null;
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      if (!response.ok) return;
      setAuthStatus(await readJson<AuthStatus>(response));
    } catch {
      setAuthStatus(null);
    }
  }, []);

  const refreshAudit = useCallback(async () => {
    setIsRefreshingAudit(true);
    try {
      const [logsResponse, verifyResponse] = await Promise.all([
        fetch("/api/audit/logs?limit=8", { cache: "no-store" }),
        fetch("/api/audit/verify", { cache: "no-store" })
      ]);
      if (logsResponse.ok) {
        const data = await readJson<{ logs: AuditLog[] }>(logsResponse, { logs: [] });
        setAuditLogs(data.logs);
      }
      if (verifyResponse.ok) {
        setAuditVerify(await readJson<AuditVerifyResult>(verifyResponse));
      }
    } catch {
      setAuditLogs([]);
      setAuditVerify(null);
    } finally {
      setIsRefreshingAudit(false);
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const [settingsResponse, logsResponse] = await Promise.all([
        fetch("/api/notifications/settings", { cache: "no-store" }),
        fetch("/api/notifications/logs?limit=8", { cache: "no-store" })
      ]);
      if (settingsResponse.ok) {
        const data = await readJson<{ settings: NotificationSettings }>(settingsResponse);
        setNotificationSettings(data.settings);
        setNotificationDraft({
          emailEnabled: data.settings.emailEnabled,
          webhookEnabled: data.settings.webhookEnabled,
          slackEnabled: data.settings.slackEnabled,
          webhookUrl: data.settings.webhookUrl ?? "",
          slackWebhookUrl: data.settings.slackWebhookUrl ?? "",
          notifyOnCompleted: data.settings.notifyOnCompleted,
          notifyOnFailed: data.settings.notifyOnFailed
        });
      }
      if (logsResponse.ok) {
        const data = await readJson<{ logs: NotificationLog[] }>(logsResponse, { logs: [] });
        setNotificationLogs(data.logs);
      }
    } catch {
      setNotificationSettings(null);
      setNotificationLogs([]);
    }
  }, []);

  const refreshScheduledTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/scheduled-tasks", { cache: "no-store" });
      if (!response.ok) return;
      const data = await readJson<{
        mailbox: string;
        tasks: ScheduledTask[];
        logs: ScheduledTaskRunLog[];
      }>(response, { mailbox: "", tasks: [], logs: [] });
      setScheduledMailbox(data.mailbox);
      setScheduledTasks(data.tasks);
      setScheduledLogs(data.logs);
    } catch {
      setScheduledMailbox("");
      setScheduledTasks([]);
      setScheduledLogs([]);
    }
  }, []);

  const refreshOrganizations = useCallback(async () => {
    try {
      const response = await fetch("/api/orgs", { cache: "no-store" });
      if (!response.ok) return;
      const data = await readJson<{ organizations: Organization[] }>(response, { organizations: [] });
      setOrganizations(data.organizations);
      setActiveOrgId((current) =>
        current && !data.organizations.some((organization) => organization.id === current) ? "" : current
      );
    } catch {
      setOrganizations([]);
    }
  }, []);

  const refreshOrganizationWorkspace = useCallback(async (orgId = activeOrgId) => {
    if (!orgId) {
      setOrgTasks([]);
      setOrgMembers([]);
      return;
    }
    try {
      const [tasksResponse, membersResponse] = await Promise.all([
        fetch(`/api/orgs/${orgId}/tasks`, { cache: "no-store" }),
        fetch(`/api/orgs/${orgId}/members`, { cache: "no-store" })
      ]);
      if (tasksResponse.ok) {
        const data = await readJson<{ tasks: Task[] }>(tasksResponse, { tasks: [] });
        setOrgTasks(data.tasks);
      }
      if (membersResponse.ok) {
        const data = await readJson<{ members: OrganizationMembership[] }>(membersResponse, { members: [] });
        setOrgMembers(data.members);
      }
    } catch {
      setOrgTasks([]);
      setOrgMembers([]);
    }
  }, [activeOrgId]);

  const acceptOrganizationInvitationFromToken = useCallback(
    async (rawToken: string, options: { fromUrl?: boolean } = {}) => {
      const token = extractInvitationToken(rawToken);
      if (!token || isAcceptingOrgInvite) return;
      setIsAcceptingOrgInvite(true);
      setError(null);
      try {
        const response = await fetch("/api/orgs/invitations/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token })
        });
        const data = await readJson<{
          invitation?: { orgId: string; role: OrganizationRole; status: string };
          organization?: Organization;
          error?: string;
        }>(response, {});
        if (!response.ok || !data.organization) {
          throw new Error(data.error ?? "接受邀请失败");
        }
        setOrgDraft((current) => ({ ...current, acceptToken: "" }));
        setOrgInviteResult(null);
        setOrgAcceptNotice(`已加入 ${data.organization.name}，角色 ${organizationRoleText[data.organization.role ?? data.invitation?.role ?? "member"]}。`);
        await refreshOrganizations();
        setActiveOrgId(data.organization.id);
        await refreshOrganizationWorkspace(data.organization.id);
        if (options.fromUrl) {
          const url = new URL(window.location.href);
          url.searchParams.delete("inviteToken");
          url.searchParams.delete("token");
          window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        }
      } catch (caught) {
        setOrgAcceptNotice(null);
        setError(getErrorMessage(caught, "接受组织邀请失败"));
      } finally {
        setIsAcceptingOrgInvite(false);
      }
    },
    [isAcceptingOrgInvite, refreshOrganizations, refreshOrganizationWorkspace]
  );

  const refreshContextMetrics = useCallback(async (taskId?: string) => {
    try {
      const suffix = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
      const response = await fetch(`/api/metrics/context-cache${suffix}`, { cache: "no-store" });
      if (!response.ok) return;
      setContextMetrics(await readJson<ContextMetricsSummary>(response));
    } catch {
      setContextMetrics(null);
    }
  }, []);

  const refreshRouterOptimizer = useCallback(async (nextPrompt = "") => {
    try {
      const suffix = nextPrompt.trim() ? `?prompt=${encodeURIComponent(nextPrompt.trim())}` : "";
      const response = await fetch(`/api/model-router/optimizer${suffix}`, { cache: "no-store" });
      if (!response.ok) return;
      setRouterOptimizer(await readJson<ModelRouterOptimizerResponse>(response));
    } catch {
      setRouterOptimizer(null);
    }
  }, []);

  const refreshBilling = useCallback(async () => {
    try {
      const response = await fetch("/api/billing", { cache: "no-store" });
      if (!response.ok) return;
      setBillingSummary(await readJson<BillingSummary>(response));
    } catch {
      setBillingSummary(null);
    }
  }, []);

  const refreshSandboxStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sandbox/status", { cache: "no-store" });
      if (!response.ok) return;
      setSandboxStatus(await readJson<SandboxStatus>(response));
    } catch {
      setSandboxStatus(null);
    }
  }, []);

  const refreshDatabaseStatus = useCallback(async (checkPostgres = false) => {
    if (checkPostgres) setIsCheckingDatabase(true);
    try {
      const suffix = checkPostgres ? "?check=1" : "";
      const response = await fetch(`/api/database/status${suffix}`, { cache: "no-store" });
      if (!response.ok) return;
      setDatabaseStatus(await readJson<DatabaseStatus>(response));
    } catch {
      setDatabaseStatus(null);
    } finally {
      if (checkPostgres) setIsCheckingDatabase(false);
    }
  }, []);

  const refreshLocalBrowserStatus = useCallback(async (endpoint?: string) => {
    setIsCheckingLocalBrowser(true);
    try {
      const response = await fetch("/api/local-browser/tabs", {
        method: endpoint ? "POST" : "GET",
        headers: endpoint ? { "Content-Type": "application/json" } : undefined,
        body: endpoint ? JSON.stringify({ endpoint }) : undefined,
        cache: "no-store"
      });
      if (!response.ok) return;
      const data = await readJson<{ status: LocalBrowserStatus; tabs: LocalBrowserTab[] }>(response);
      setLocalBrowserStatus(data.status);
      setLocalBrowserTabs(data.tabs);
      setLocalBrowserEndpoint(data.status.endpoint);
      setLocalBrowserSafety({
        paused: Boolean(data.status.paused),
        recentOperations: data.status.recentOperations ?? [],
        pendingApprovals: []
      });
    } catch {
      setLocalBrowserStatus(null);
      setLocalBrowserTabs([]);
    } finally {
      setIsCheckingLocalBrowser(false);
    }
  }, []);

  const refreshLocalBrowserSafety = useCallback(async () => {
    try {
      const response = await fetch("/api/local-browser/safety", { cache: "no-store" });
      if (!response.ok) return;
      setLocalBrowserSafety(await readJson<LocalBrowserSafetyState>(response));
    } catch {
      setLocalBrowserSafety(null);
    }
  }, []);

  const refreshLocalBrowserPairing = useCallback(async () => {
    try {
      const response = await fetch("/api/local-browser/pairing", { cache: "no-store" });
      if (!response.ok) return;
      setLocalBrowserPairing(await readJson<LocalBrowserPairingStatus>(response));
    } catch {
      setLocalBrowserPairing(null);
    }
  }, []);

  const refreshMyComputerStatus = useCallback(async () => {
    setIsCheckingMyComputer(true);
    try {
      const [response, pairingResponse] = await Promise.all([
        fetch("/api/my-computer/status", { cache: "no-store" }),
        fetch("/api/my-computer/desktop/pairing", { cache: "no-store" })
      ]);
      if (!response.ok) return;
      const data = await readJson<MyComputerStatus>(response);
      setMyComputerStatus(data);
      const onlineDesktop = data.desktopDevices.some((device) => device.status === "online");
      if (!onlineDesktop) setExecutionTarget("cloud");
      if (pairingResponse.ok) {
        setMyComputerPairing(await readJson<MyComputerDesktopPairingStatus>(pairingResponse));
      }
      setSettingsDraft((current) => ({
        ...current,
        myComputerAllowedRoots: data.allowedRoots.join("\n")
      }));
      setMyComputerDraft((current) => ({
        ...current,
        root: current.root || data.allowedRoots[0] || ""
      }));
    } catch {
      setMyComputerStatus(null);
      setMyComputerPairing(null);
    } finally {
      setIsCheckingMyComputer(false);
    }
  }, []);

  const createMyComputerDesktopPairing = useCallback(async () => {
    setIsCreatingMyComputerPairing(true);
    setMyComputerError(null);
    setMyComputerNotice(null);
    try {
      const response = await fetch("/api/my-computer/desktop/pairing", { method: "POST" });
      const data = await readJson<MyComputerDesktopPairingStatus & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "生成桌面端配对码失败");
      setMyComputerPairing(data);
      setMyComputerNotice("桌面端配对码已生成，请在 ManusXL Desktop 输入。");
      await refreshMyComputerStatus();
    } catch (caught: unknown) {
      const message = getErrorMessage(caught, "生成桌面端配对码失败");
      setMyComputerError(message);
      setError(message);
    } finally {
      setIsCreatingMyComputerPairing(false);
    }
  }, [refreshMyComputerStatus]);

  const createLocalBrowserPairing = useCallback(async () => {
    setIsCreatingLocalBrowserPairing(true);
    try {
      const response = await fetch("/api/local-browser/pairing", { method: "POST" });
      setLocalBrowserPairing(await readJson<LocalBrowserPairingStatus>(response));
    } catch (caught: unknown) {
      setError(getErrorMessage(caught, "生成本地浏览器配对码失败"));
    } finally {
      setIsCreatingLocalBrowserPairing(false);
    }
  }, []);

  const captureLocalBrowserScreenshot = useCallback(async () => {
    setIsCapturingLocalBrowser(true);
    setLocalBrowserActionResult(null);
    try {
      const response = await fetch("/api/local-browser/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: localBrowserEndpoint,
          tabId: localBrowserTabs[0]?.id,
          format: "jpeg",
          quality: 70
        })
      });
      const data = await readJson<LocalBrowserScreenshot>(response);
      setLocalBrowserScreenshot(data);
      if (!data.ok) setError(data.error ?? "本地浏览器截图失败");
      await refreshLocalBrowserSafety();
    } catch (caught: unknown) {
      setError(getErrorMessage(caught, "本地浏览器截图失败"));
    } finally {
      setIsCapturingLocalBrowser(false);
    }
  }, [localBrowserEndpoint, localBrowserTabs, refreshLocalBrowserSafety]);

  const runLocalBrowserControlAction = useCallback(async () => {
    setIsRunningLocalBrowserAction(true);
    try {
      const body = {
        endpoint: localBrowserEndpoint,
        tabId: localBrowserTabs[0]?.id,
        action: localBrowserActionDraft.action,
        url: localBrowserActionDraft.url,
        x: localBrowserActionDraft.x ? Number(localBrowserActionDraft.x) : undefined,
        y: localBrowserActionDraft.y ? Number(localBrowserActionDraft.y) : undefined,
        text: localBrowserActionDraft.text,
        key: localBrowserActionDraft.key,
        waitMs: 900
      };
      const response = await fetch("/api/local-browser/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await readJson<LocalBrowserActionResult>(response);
      setLocalBrowserActionResult(data);
      if (!data.ok) {
        setError(data.error ?? "本地浏览器动作失败");
        await refreshLocalBrowserSafety();
        return;
      }
      await refreshLocalBrowserStatus(localBrowserEndpoint);
      await refreshLocalBrowserSafety();
    } catch (caught: unknown) {
      setError(getErrorMessage(caught, "本地浏览器动作失败"));
    } finally {
      setIsRunningLocalBrowserAction(false);
    }
  }, [
    localBrowserActionDraft,
    localBrowserEndpoint,
    localBrowserTabs,
    refreshLocalBrowserSafety,
    refreshLocalBrowserStatus
  ]);

  const toggleLocalBrowserPause = useCallback(async (paused: boolean) => {
    setIsTogglingLocalBrowserPause(true);
    try {
      const response = await fetch("/api/local-browser/safety", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused })
      });
      const data = await readJson<LocalBrowserSafetyState>(response);
      setLocalBrowserSafety(data);
      setLocalBrowserStatus((current) =>
        current
          ? {
              ...current,
              paused: data.paused,
              recentOperations: data.recentOperations
            }
          : current
      );
    } catch (caught: unknown) {
      setError(getErrorMessage(caught, "切换本地浏览器安全开关失败"));
    } finally {
      setIsTogglingLocalBrowserPause(false);
    }
  }, []);

  const saveMyComputerSettings = useCallback(async (paused?: boolean) => {
    setIsSavingMyComputer(true);
    setMyComputerError(null);
    setMyComputerNotice(null);
    try {
      const response = await fetch("/api/my-computer/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowedRoots: parseFilesystemRoots(settingsDraft.myComputerAllowedRoots),
          paused
        })
      });
      const data = await readJson<MyComputerStatus & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "保存 My Computer 设置失败");
      setMyComputerStatus(data);
      setSettingsDraft((current) => ({
        ...current,
        myComputerAllowedRoots: data.allowedRoots.join("\n")
      }));
      setMyComputerDraft((current) => ({
        ...current,
        root: data.allowedRoots.includes(current.root) ? current.root : data.allowedRoots[0] || current.root
      }));
      setMyComputerNotice(
        paused === true
          ? "My Computer 已暂停。恢复后才能扫描目录、生成 Dry-run 或执行本机动作。"
          : paused === false
            ? "My Computer 已恢复，可以继续扫描目录和生成 Dry-run。"
            : "My Computer 允许目录已保存。"
      );
      setError(null);
    } catch (caught: unknown) {
      const message = getErrorMessage(caught, "保存 My Computer 设置失败");
      setMyComputerError(message);
      setError(message);
    } finally {
      setIsSavingMyComputer(false);
    }
  }, [settingsDraft.myComputerAllowedRoots]);

  const clearMyComputerAlwaysAllow = useCallback(async () => {
    setIsSavingMyComputer(true);
    setMyComputerError(null);
    setMyComputerNotice(null);
    try {
      const response = await fetch("/api/my-computer/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowedRoots: parseFilesystemRoots(settingsDraft.myComputerAllowedRoots),
          paused: myComputerStatus?.paused,
          alwaysAllowRules: []
        })
      });
      const data = await readJson<MyComputerStatus & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "清空 My Computer 授权规则失败");
      setMyComputerStatus(data);
      setMyComputerNotice("My Computer 授权规则已清空。");
      setError(null);
    } catch (caught: unknown) {
      const message = getErrorMessage(caught, "清空 My Computer 授权规则失败");
      setMyComputerError(message);
      setError(message);
    } finally {
      setIsSavingMyComputer(false);
    }
  }, [myComputerStatus, settingsDraft.myComputerAllowedRoots]);

  const scanMyComputerRoot = useCallback(async () => {
    const root = myComputerDraft.root.trim();
    setMyComputerError(null);
    setMyComputerNotice(null);
    if (myComputerStatus?.paused) {
      setMyComputerError("My Computer 已暂停。请先点击“恢复 My Computer”，再扫描目录。");
      return;
    }
    if (!root) {
      setMyComputerError("请先填写目标目录。");
      return;
    }
    setIsScanningMyComputer(true);
    setMyComputerPlan(null);
    try {
      const response = await fetch("/api/my-computer/files/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root,
          maxFiles: 120,
          maxDepth: 2
        })
      });
      const data = await readJson<MyComputerFileScanResponse>(response);
      if (!response.ok) throw new Error((data as { error?: string }).error ?? "扫描失败");
      setMyComputerScan(data);
      setMyComputerNotice(`扫描完成：${data.total} 项${data.truncated ? "，结果已截断" : ""}。`);
      setError(null);
      await refreshMyComputerStatus();
    } catch (caught: unknown) {
      const message = getErrorMessage(caught, "扫描本机目录失败");
      setMyComputerError(message);
      setError(message);
    } finally {
      setIsScanningMyComputer(false);
    }
  }, [myComputerDraft.root, myComputerStatus?.paused, refreshMyComputerStatus]);

  const planMyComputerFiles = useCallback(async () => {
    const root = myComputerDraft.root.trim();
    setMyComputerError(null);
    setMyComputerNotice(null);
    if (myComputerStatus?.paused) {
      setMyComputerError("My Computer 已暂停。请先点击“恢复 My Computer”，再生成 Dry-run。");
      return;
    }
    if (!root) {
      setMyComputerError("请先填写目标目录。");
      return;
    }
    setIsPlanningMyComputer(true);
    try {
      const response = await fetch("/api/my-computer/files/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root,
          mode: myComputerDraft.mode,
          maxFiles: 160
        })
      });
      const data = await readJson<MyComputerFilePlanResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "生成文件操作预览失败");
      setMyComputerPlan(data);
      setMyComputerActionResult(null);
      setMyComputerNotice(
        `Dry-run 已生成：${data.summary.actionCount} 个动作，影响 ${data.summary.affectedFiles} 个文件。`
      );
      setError(null);
      await refreshMyComputerStatus();
    } catch (caught: unknown) {
      const message = getErrorMessage(caught, "生成 My Computer 文件计划失败");
      setMyComputerError(message);
      setError(message);
    } finally {
      setIsPlanningMyComputer(false);
    }
  }, [myComputerDraft.mode, myComputerDraft.root, myComputerStatus?.paused, refreshMyComputerStatus]);

  const approveMyComputerOperation = useCallback(async (operationId: string, decision: "allow_once" | "always" | "deny") => {
    setIsApprovingMyComputer(true);
    try {
      const response = await fetch("/api/my-computer/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId, decision })
      });
      const data = await readJson<{ operation?: MyComputerOperation; error?: string }>(response);
      if (!response.ok || !data.operation) throw new Error(data.error ?? "授权操作失败");
      setMyComputerActionResult(data.operation);
      setMyComputerPlan((current) =>
        current && current.operation.id === data.operation?.id
          ? { ...current, operation: data.operation }
          : current
      );
      await refreshMyComputerStatus();
      if (data.operation.kind.startsWith("file_")) {
        await scanMyComputerRoot();
      }
    } catch (caught: unknown) {
      setError(getErrorMessage(caught, "执行 My Computer 授权操作失败"));
    } finally {
      setIsApprovingMyComputer(false);
    }
  }, [refreshMyComputerStatus, scanMyComputerRoot]);

  const runMyComputerSystemAction = useCallback(async () => {
    setIsRunningMyComputerAction(true);
    try {
      const response = await fetch("/api/my-computer/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: myComputerDraft.actionKind,
          target:
            myComputerDraft.actionKind === "clipboard_write" || myComputerDraft.actionKind === "clipboard_read"
              ? undefined
              : myComputerDraft.actionKind === "mouse_click"
                ? "screen"
                : myComputerDraft.actionTarget,
          text: myComputerDraft.actionKind === "clipboard_write" ? myComputerDraft.actionText : undefined,
          command: myComputerDraft.actionKind === "terminal_command" ? myComputerDraft.actionCommand : undefined,
          x: myComputerDraft.actionKind === "mouse_click" ? Number(myComputerDraft.x) : undefined,
          y: myComputerDraft.actionKind === "mouse_click" ? Number(myComputerDraft.y) : undefined,
          dryRun: true
        })
      });
      const data = await readJson<{ operation?: MyComputerOperation; error?: string }>(response);
      if (!response.ok || !data.operation) throw new Error(data.error ?? "创建本机动作失败");
      setMyComputerActionResult(data.operation);
      await refreshMyComputerStatus();
    } catch (caught: unknown) {
      setError(getErrorMessage(caught, "创建 My Computer 动作失败"));
    } finally {
      setIsRunningMyComputerAction(false);
    }
  }, [myComputerDraft, refreshMyComputerStatus]);

  const undoMyComputerLastFileOperation = useCallback(async () => {
    setIsUndoingMyComputer(true);
    try {
      const response = await fetch("/api/my-computer/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: myComputerPlan?.operation.status === "completed" ? myComputerPlan.operation.id : undefined
        })
      });
      const data = await readJson<{ operation?: MyComputerOperation; error?: string }>(response);
      if (!response.ok || !data.operation) throw new Error(data.error ?? "撤销 My Computer 操作失败");
      setMyComputerActionResult(data.operation);
      await refreshMyComputerStatus();
      await scanMyComputerRoot();
    } catch (caught: unknown) {
      setError(getErrorMessage(caught, "撤销 My Computer 文件操作失败"));
    } finally {
      setIsUndoingMyComputer(false);
    }
  }, [myComputerPlan, refreshMyComputerStatus, scanMyComputerRoot]);

  const refreshOcrStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/ocr/status", { cache: "no-store" });
      if (!response.ok) return;
      setOcrStatus(await readJson<OcrStatus>(response));
    } catch {
      setOcrStatus(null);
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      if (response.status === 401) {
        setAuthUser(null);
        setTasks([]);
        setActiveTask(null);
        return;
      }
      if (!response.ok) return;
      const data = await readJson<{ tasks: Task[] }>(response, { tasks: [] });
      setTasks(data.tasks);
      setActiveTask((current) => {
        if (current) {
          return data.tasks.find((task) => task.id === current.id) ?? null;
        }
        return null;
      });
    } catch (caught) {
      setError(getErrorMessage(caught, "刷新任务失败"));
    }
  }, []);

  const refreshLibraryFiles = useCallback(async () => {
    try {
      const response = await fetch("/api/files", { cache: "no-store" });
      if (response.status === 401) {
        setLibraryFiles([]);
        return;
      }
      if (!response.ok) return;
      const data = await readJson<{ files: UploadedLibraryFile[] }>(response, { files: [] });
      setLibraryFiles(data.files);
    } catch {
      setLibraryFiles([]);
    }
  }, []);

  const refreshTemplates = useCallback(async () => {
    try {
      const response = await fetch("/api/templates", { cache: "no-store" });
      if (!response.ok) return;
      const data = await readJson<{ templates: TaskTemplate[] }>(response, { templates: [] });
      setTemplates(data.templates);
    } catch {
      setTemplates([]);
    }
  }, []);

  const refreshMarketplaceTemplates = useCallback(async (sort: MarketplaceSort = "featured") => {
    try {
      const response = await fetch(`/api/marketplace/templates?sort=${sort}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await readJson<{ templates: TaskTemplate[] }>(response, { templates: [] });
      setMarketplaceTemplates(data.templates);
    } catch {
      setMarketplaceTemplates([]);
    }
  }, []);

  const refreshSkills = useCallback(async () => {
    try {
      const response = await fetch("/api/skills", { cache: "no-store" });
      if (!response.ok) {
        setSkills(defaultSkills);
        return;
      }
      const data = await readJson<{ skills: AgentSkill[] }>(response, { skills: [] });
      setSkills(data.skills.length > 0 ? data.skills : defaultSkills);
    } catch {
      setSkills(defaultSkills);
    }
  }, []);

  const refreshMcpServers = useCallback(async () => {
    try {
      const response = await fetch("/api/mcp", { cache: "no-store" });
      if (!response.ok) return;
      const data = await readJson<{ servers: McpServer[] }>(response, { servers: [] });
      setMcpServers(data.servers);
    } catch {
      setMcpServers([]);
    }
  }, []);

  const refreshMcpCatalog = useCallback(async () => {
    try {
      const response = await fetch("/api/mcp/catalog", { cache: "no-store" });
      if (!response.ok) return;
      const data = await readJson<{ catalog: McpCatalogItem[] }>(response, { catalog: [] });
      setMcpCatalog(data.catalog);
    } catch {
      setMcpCatalog([]);
    }
  }, []);

  const connectStream = useCallback(
    (taskId: string) => {
      closeStream();
      const source = new EventSource(`/api/tasks/${taskId}/events`);
      eventSourceRef.current = source;

      source.addEventListener("agent_event", (message) => {
        const event = JSON.parse(message.data) as AgentEvent;
        setActiveTask((current) => (current?.id === taskId ? mergeTaskEvent(current, event) : current));
        setTasks((current) =>
          current.map((task) => (task.id === taskId ? mergeTaskEvent(task, event) : task))
        );

        if (event.type === "finished" || event.type === "failed") {
          source.close();
          eventSourceRef.current = null;
          void refreshTasks();
          void refreshRouterOptimizer();
        }
      });

      source.onerror = () => {
        source.close();
        eventSourceRef.current = null;
      };
    },
    [closeStream, refreshRouterOptimizer, refreshTasks]
  );

  const selectTask = useCallback(
    async (taskId: string) => {
      const response = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
      if (!response.ok) return;
      const task = await readJson<Task>(response);
      setActiveTask(task);
      setActiveNav("agent");
      if (task.status === "running" || task.status === "queued") {
        connectStream(task.id);
      } else {
        closeStream();
      }
    },
    [closeStream, connectStream]
  );

  const resumePendingTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks/resume", { method: "POST" });
      if (!response.ok) return;
      const data = await readJson<{ resumedTaskIds: string[]; skippedTaskIds: string[] }>(
        response,
        { resumedTaskIds: [], skippedTaskIds: [] }
      );
      if (data.resumedTaskIds.length > 0 || data.skippedTaskIds.length > 0) {
        await refreshTasks();
      }
    } catch {
      // Resume is best-effort; normal refresh still shows persisted task history.
    }
  }, [refreshTasks]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshAuthUser().then(async (user) => {
        if (!user) return;
        await resumePendingTasks();
        await refreshTasks();
        void refreshLibraryFiles();
        void refreshAuthStatus();
        void refreshAudit();
        void refreshNotifications();
        void refreshScheduledTasks();
        void refreshOrganizations();
        void refreshTemplates();
        void refreshMarketplaceTemplates();
        void refreshSkills();
        void refreshMcpServers();
        void refreshMcpCatalog();
        void refreshBilling();
        void refreshRouterOptimizer();
        void refreshSandboxStatus();
        void refreshDatabaseStatus();
        void refreshLocalBrowserStatus();
        void refreshLocalBrowserSafety();
        void refreshLocalBrowserPairing();
        void refreshMyComputerStatus();
        void refreshOcrStatus();
      });
      void fetch("/api/config", { cache: "no-store" })
        .then((response) => (response.ok ? readJson<ConfigResponse>(response) : null))
        .then((data) => {
          if (!data) return;
          setConfig(data);
          setSettingsDraft((current) => ({
            ...current,
            model: data.model,
            baseUrl: data.baseUrl,
            temperature: String(data.temperature),
            maxSteps: String(data.maxSteps),
            taskBudgetUsd: String(data.taskBudgetUsd),
            planningModel: data.planningModel,
            executionModel: data.executionModel,
            finalModel: data.finalModel,
            promptCacheEnabled: data.promptCacheEnabled,
            localBrowserDomainAllowlist: data.localBrowserDomainAllowlist.join("\n"),
            myComputerAllowedRoots: data.myComputerAllowedRoots.join("\n"),
            designImageProvider: data.designImageProvider,
            designImageApiKey: "",
            designImageMaxPerTask: String(data.designImageMaxPerTask)
          }));
          setMyComputerDraft((current) => ({
            ...current,
            root: current.root || data.myComputerAllowedRoots[0] || ""
          }));
        })
        .catch((caught: unknown) => {
          setError(getErrorMessage(caught, "加载配置失败"));
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      closeStream();
    };
  }, [
    closeStream,
    refreshAudit,
    refreshAuthStatus,
    refreshAuthUser,
    refreshBilling,
    refreshDatabaseStatus,
    refreshLocalBrowserSafety,
    refreshLocalBrowserPairing,
    refreshLocalBrowserStatus,
    refreshLibraryFiles,
    refreshMarketplaceTemplates,
    refreshMyComputerStatus,
    refreshMcpCatalog,
    refreshMcpServers,
    refreshOcrStatus,
    refreshNotifications,
    refreshOrganizations,
    refreshScheduledTasks,
    refreshRouterOptimizer,
    refreshSandboxStatus,
    resumePendingTasks,
    refreshSkills,
    refreshTasks,
    refreshTemplates
  ]);

  useEffect(() => {
    if (!authUser) return;
    const timer = window.setTimeout(() => {
      void refreshMarketplaceTemplates(marketplaceSort);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authUser, marketplaceSort, refreshMarketplaceTemplates]);

  useEffect(() => {
    if (!authUser) return;
    const timer = window.setTimeout(() => {
      void refreshOrganizationWorkspace(activeOrgId);
      setOrgInviteResult(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeOrgId, authUser, refreshOrganizationWorkspace]);

  useEffect(() => {
    if (!authUser || initialInviteTokenRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("inviteToken") ?? params.get("token");
    if (!token) return;
    initialInviteTokenRef.current = token;
    const timer = window.setTimeout(() => {
      void acceptOrganizationInvitationFromToken(token, { fromUrl: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [acceptOrganizationInvitationFromToken, authUser]);

  useEffect(() => {
    if (!authUser || initialTaskParamRef.current) return;
    const taskId = new URLSearchParams(window.location.search).get("taskId");
    if (!taskId) return;
    initialTaskParamRef.current = taskId;
    const timer = window.setTimeout(() => {
      void selectTask(taskId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authUser, selectTask]);

  useEffect(() => {
    if (!activeTaskId || (activeTaskStatus !== "running" && activeTaskStatus !== "queued")) return;
    connectStream(activeTaskId);
  }, [activeTaskId, activeTaskStatus, connectStream]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshContextMetrics(activeTask?.id);
      void refreshBilling();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTask?.id, activeTask?.events.length, refreshBilling, refreshContextMetrics]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAuthSubmitting(true);
    setError(null);
    setAuthNotice(null);

    try {
      const endpoint =
        authMode === "phone"
          ? authDraft.verificationCode.trim()
            ? "/api/auth/phone/verify"
            : "/api/auth/phone/request"
          : authMode === "email-register"
            ? authDraft.verificationCode.trim()
              ? "/api/auth/verify"
              : "/api/auth/register"
            : "/api/auth/login";
      const body =
        authMode === "phone"
          ? authDraft
          : authMode === "email-register" && authDraft.verificationCode.trim()
            ? {
                email: authDraft.email,
                code: authDraft.verificationCode
              }
            : {
                email: authDraft.email,
                password: authDraft.password,
                displayName: authDraft.displayName
              };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await readJson<
        Partial<AuthResponse> & {
          error?: string;
          verificationCode?: string;
          emailDelivery?: { mode?: "development" | "smtp"; sent?: boolean; error?: string };
        }
      >(response, {});
      if (!response.ok) {
        throw new Error(data.error ?? "认证失败");
      }

      if (authMode === "phone" && !authDraft.verificationCode.trim()) {
        setAuthDraft((current) => ({
          ...current,
          verificationCode: data.verificationCode ?? ""
        }));
        setAuthNotice(
          data.verificationCode
            ? `本地开发验证码：${data.verificationCode}`
            : "验证码已生成，请输入验证码。"
        );
        return;
      }
      if (authMode === "email-register" && !authDraft.verificationCode.trim()) {
        setAuthDraft((current) => ({
          ...current,
          verificationCode: data.verificationCode ?? ""
        }));
        setAuthNotice(
          data.verificationCode
            ? `本地邮箱验证码：${data.verificationCode}`
            : data.emailDelivery?.sent
              ? "验证邮件已发送，请输入邮箱中的验证码。"
              : "验证邮件已生成，请输入验证码。"
        );
        return;
      }

      if (data.user) {
        setAuthUser(data.user);
        setAuthNotice(null);
        await resumePendingTasks();
        await refreshTasks();
        await refreshTemplates();
        await refreshOrganizations();
        await refreshScheduledTasks();
        await refreshSkills();
        await refreshMcpServers();
        await refreshBilling();
        await refreshMyComputerStatus();
      }
    } catch (caught) {
      setError(getErrorMessage(caught, "认证失败"));
    } finally {
      setIsAuthSubmitting(false);
      setIsAuthLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    closeStream();
    setAuthUser(null);
    setTasks([]);
    setActiveTask(null);
    setContextMetrics(null);
    setScheduledTasks([]);
    setScheduledLogs([]);
    setScheduledMailbox("");
    setOrganizations([]);
    setActiveOrgId("");
    setOrgTasks([]);
    setOrgMembers([]);
    setBillingSummary(null);
    setSandboxStatus(null);
    setSandboxSelfTest(null);
  }

  async function submitTask(nextPrompt = prompt) {
    const trimmed = buildPromptWithFiles(nextPrompt, uploadedFiles);
    if ((!nextPrompt.trim() && uploadedFiles.length === 0) || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          model: config?.model,
          fileIds: uploadedFiles.map((file) => file.id),
          orgId: activeOrgId || undefined,
          visibility: activeOrgId ? "org" : "private",
          executionTarget
        })
      });

      if (!response.ok) {
        const data = await readJson<{ error?: string }>(response, {});
        throw new Error(data.error ?? `创建任务失败 (${response.status})`);
      }

      const data = await readJson<CreateTaskResponse>(response);
      let task = createOptimisticTask(
        data.taskId,
        trimmed,
        config?.model ?? settingsDraft.model,
        data.status
      );

      try {
        const taskResponse = await fetch(`/api/tasks/${data.taskId}`, { cache: "no-store" });
        if (taskResponse.ok) {
          task = await readJson<Task>(taskResponse);
        }
      } catch {
        // The SSE stream can still hydrate the optimistic task if the detail request races dev reload.
      }

      setPrompt("");
      setUploadedFiles([]);
      setActiveTask(task);
      setActiveNav("agent");
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      connectStream(task.id);
      if (activeOrgId) {
        void refreshOrganizationWorkspace(activeOrgId);
        void refreshOrganizations();
      }
      void refreshRouterOptimizer(trimmed);
    } catch (caught) {
      setError(getErrorMessage(caught, "创建任务失败"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    setIsUploadingFile(true);
    setError(null);

    try {
      const analyzedFiles: UploadedFileSummary[] = [];

      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/files/analyze", {
          method: "POST",
          body: formData
        });

        const data = await readJson<Partial<AnalyzeFileResponse> & { error?: string }>(response, {});
        if (!response.ok || !data.file) {
          throw new Error(data.error ?? `${file.name} 解析失败`);
        }
        analyzedFiles.push(data.file);
      }

      setUploadedFiles((current) => [...current, ...analyzedFiles]);
      await refreshLibraryFiles();
    } catch (caught) {
      setError(getErrorMessage(caught, "文件上传失败"));
    } finally {
      setIsUploadingFile(false);
    }
  }

  async function cancelActiveTask() {
    if (!activeTask) return;
    await fetch(`/api/tasks/${activeTask.id}/cancel`, { method: "POST" });
    closeStream();
    await refreshTasks();
  }

  async function retryActiveTask() {
    if (!activeTask || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${activeTask.id}/retry`, { method: "POST" });
      if (!response.ok) {
        const data = await readJson<{ error?: string }>(response, {});
        throw new Error(data.error ?? `重跑任务失败 (${response.status})`);
      }

      const data = await readJson<CreateTaskResponse>(response);
      let task = createOptimisticTask(
        data.taskId,
        activeTask.prompt,
        activeTask.model,
        data.status
      );

      const taskResponse = await fetch(`/api/tasks/${data.taskId}`, { cache: "no-store" });
      if (taskResponse.ok) {
        task = await readJson<Task>(taskResponse);
      }

      setActiveTask(task);
      setActiveNav("agent");
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      connectStream(task.id);
    } catch (caught) {
      setError(getErrorMessage(caught, "重跑任务失败"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveSettings() {
    setIsSavingSettings(true);
    try {
      const response = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: settingsDraft.apiKey || undefined,
          model: settingsDraft.model,
          baseUrl: settingsDraft.baseUrl,
          temperature: Number(settingsDraft.temperature),
          maxSteps: Number(settingsDraft.maxSteps),
          taskBudgetUsd: Number(settingsDraft.taskBudgetUsd),
          planningModel: settingsDraft.planningModel,
          executionModel: settingsDraft.executionModel,
          finalModel: settingsDraft.finalModel,
          promptCacheEnabled: settingsDraft.promptCacheEnabled,
          localBrowserDomainAllowlist: parseDomainAllowlist(settingsDraft.localBrowserDomainAllowlist),
          myComputerAllowedRoots: parseFilesystemRoots(settingsDraft.myComputerAllowedRoots),
          designImageProvider: settingsDraft.designImageProvider,
          designImageApiKey: settingsDraft.designImageApiKey || undefined,
          designImageMaxPerTask: Number(settingsDraft.designImageMaxPerTask)
        })
      });
      const data = await readJson<ConfigResponse>(response);
      setConfig(data);
      setSettingsDraft((current) => ({
        ...current,
        apiKey: "",
        designImageApiKey: "",
        localBrowserDomainAllowlist: data.localBrowserDomainAllowlist.join("\n"),
        myComputerAllowedRoots: data.myComputerAllowedRoots.join("\n"),
        designImageProvider: data.designImageProvider,
        designImageMaxPerTask: String(data.designImageMaxPerTask)
      }));
      void refreshRouterOptimizer();
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function applyRouterRecommendation() {
    if (!routerOptimizer) return;
    setIsApplyingRouterPolicy(true);
    try {
      const policy = routerOptimizer.recommendation.policy;
      const response = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planningModel: policy.planning.model,
          executionModel: policy.execution.model,
          finalModel: policy.finalAnswer.model
        })
      });
      const data = await readJson<ConfigResponse>(response);
      setConfig(data);
      setSettingsDraft((current) => ({
        ...current,
        planningModel: data.planningModel,
        executionModel: data.executionModel,
        finalModel: data.finalModel
      }));
      await refreshRouterOptimizer();
    } finally {
      setIsApplyingRouterPolicy(false);
    }
  }

  async function saveLocalBrowserAllowlist() {
    setIsSavingLocalBrowserAllowlist(true);
    try {
      const response = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localBrowserDomainAllowlist: parseDomainAllowlist(settingsDraft.localBrowserDomainAllowlist)
        })
      });
      const data = await readJson<ConfigResponse>(response);
      setConfig(data);
      setSettingsDraft((current) => ({
        ...current,
        localBrowserDomainAllowlist: data.localBrowserDomainAllowlist.join("\n")
      }));
      await refreshLocalBrowserStatus(localBrowserEndpoint);
    } catch (caught: unknown) {
      setError(getErrorMessage(caught, "保存本地浏览器域名失败"));
    } finally {
      setIsSavingLocalBrowserAllowlist(false);
    }
  }

  async function saveNotificationSettings() {
    setIsSavingNotifications(true);
    try {
      const response = await fetch("/api/notifications/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationDraft)
      });
      if (!response.ok) throw new Error("通知配置保存失败");
      await refreshNotifications();
    } catch (caught) {
      setError(getErrorMessage(caught, "通知配置保存失败"));
    } finally {
      setIsSavingNotifications(false);
    }
  }

  async function sendNotificationTest(status: "completed" | "failed" = "completed") {
    setIsTestingNotifications(true);
    try {
      const response = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!response.ok) throw new Error("通知测试失败");
      await refreshNotifications();
    } catch (caught) {
      setError(getErrorMessage(caught, "通知测试失败"));
    } finally {
      setIsTestingNotifications(false);
    }
  }

  async function createScheduledTaskFromDraft() {
    const promptText = scheduledDraft.prompt.trim();
    if (!promptText) return;
    setIsCreatingScheduledTask(true);
    try {
      const response = await fetch("/api/scheduled-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: scheduledDraft.name || undefined,
          prompt: promptText,
          model: config?.model,
          kind: scheduledDraft.kind,
          intervalMinutes: Number(scheduledDraft.intervalMinutes),
          cronExpression: scheduledDraft.cronExpression
        })
      });
      const data = await readJson<{ error?: string }>(response, {});
      if (!response.ok) throw new Error(data.error ?? "创建定时任务失败");
      setScheduledDraft((current) => ({ ...current, name: "", prompt: "" }));
      await refreshScheduledTasks();
    } catch (caught) {
      setError(getErrorMessage(caught, "创建定时任务失败"));
    } finally {
      setIsCreatingScheduledTask(false);
    }
  }

  async function createOrganizationFromDraft() {
    const name = orgDraft.name.trim();
    if (!name || isCreatingOrg) return;
    setIsCreatingOrg(true);
    setError(null);
    try {
      const response = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          taskQuota: Number(orgDraft.taskQuota)
        })
      });
      const data = await readJson<{ organization?: Organization; error?: string }>(response, {});
      if (!response.ok || !data.organization) {
        throw new Error(data.error ?? "创建组织失败");
      }
      setOrgDraft((current) => ({ ...current, name: "" }));
      setOrgAcceptNotice(null);
      setActiveOrgId(data.organization.id);
      await refreshOrganizations();
      await refreshOrganizationWorkspace(data.organization.id);
    } catch (caught) {
      setError(getErrorMessage(caught, "创建组织失败"));
    } finally {
      setIsCreatingOrg(false);
    }
  }

  async function inviteOrganizationMember() {
    if (!activeOrgId || !orgDraft.invitePhone.trim() || isInvitingOrgMember) return;
    setIsInvitingOrgMember(true);
    setError(null);
    try {
      const response = await fetch(`/api/orgs/${activeOrgId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: orgDraft.invitePhone,
          role: orgDraft.inviteRole
        })
      });
      const data = await readJson<{
        invitation?: { token: string; role: Exclude<OrganizationRole, "owner"> };
        acceptUrl?: string;
        error?: string;
      }>(response, {});
      if (!response.ok || !data.invitation) {
        throw new Error(data.error ?? "邀请成员失败");
      }
      const acceptUrl = data.acceptUrl
        ? new URL(data.acceptUrl, window.location.origin).toString()
        : "";
      setOrgInviteResult({
        phone: orgDraft.invitePhone.trim(),
        role: data.invitation.role,
        acceptUrl,
        token: data.invitation.token
      });
      setOrgAcceptNotice(null);
      setOrgDraft((current) => ({ ...current, invitePhone: "" }));
      await refreshOrganizationWorkspace(activeOrgId);
    } catch (caught) {
      setError(getErrorMessage(caught, "邀请成员失败"));
    } finally {
      setIsInvitingOrgMember(false);
    }
  }

  async function updateOrganizationMember(member: OrganizationMembership, role: Exclude<OrganizationRole, "owner">) {
    if (!activeOrgId || member.role === role || managingOrgMemberId) return;
    setManagingOrgMemberId(member.userId);
    setError(null);
    try {
      const response = await fetch(`/api/orgs/${activeOrgId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId, role })
      });
      const data = await readJson<{ members?: OrganizationMembership[]; error?: string }>(response, {});
      if (!response.ok || !data.members) {
        throw new Error(data.error ?? "修改成员角色失败");
      }
      setOrgMembers(data.members);
      await refreshOrganizations();
    } catch (caught) {
      setError(getErrorMessage(caught, "修改成员角色失败"));
    } finally {
      setManagingOrgMemberId(null);
    }
  }

  async function removeOrganizationMemberFromOrg(member: OrganizationMembership) {
    if (!activeOrgId || managingOrgMemberId) return;
    const label = member.user?.displayName ?? member.user?.phone ?? member.user?.email ?? member.userId;
    if (!window.confirm(`确定从当前组织移除 ${label} 吗？`)) return;
    setManagingOrgMemberId(member.userId);
    setError(null);
    try {
      const response = await fetch(`/api/orgs/${activeOrgId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId })
      });
      const data = await readJson<{ members?: OrganizationMembership[]; error?: string }>(response, {});
      if (!response.ok || !data.members) {
        throw new Error(data.error ?? "移除成员失败");
      }
      setOrgMembers(data.members);
      await refreshOrganizations();
      await refreshOrganizationWorkspace(activeOrgId);
    } catch (caught) {
      setError(getErrorMessage(caught, "移除成员失败"));
    } finally {
      setManagingOrgMemberId(null);
    }
  }

  async function scheduleTaskFromHistory(task: Task) {
    setIsCreatingScheduledTask(true);
    try {
      const response = await fetch("/api/scheduled-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: getUserVisiblePrompt(task.prompt).slice(0, 48),
          prompt: task.prompt,
          model: task.model,
          kind: "cron",
          cronExpression: "0 9 * * 1"
        })
      });
      const data = await readJson<{ error?: string }>(response, {});
      if (!response.ok) throw new Error(data.error ?? "设置定时任务失败");
      setActiveNav("settings");
      await refreshScheduledTasks();
    } catch (caught) {
      setError(getErrorMessage(caught, "设置定时任务失败"));
    } finally {
      setIsCreatingScheduledTask(false);
    }
  }

  async function runScheduledTaskNow(scheduleId: string) {
    setIsRunningScheduledTask(true);
    try {
      const response = await fetch(`/api/scheduled-tasks/${scheduleId}/run`, { method: "POST" });
      const data = await readJson<{ error?: string }>(response, {});
      if (!response.ok) throw new Error(data.error ?? "运行定时任务失败");
      await refreshScheduledTasks();
      await refreshTasks();
    } catch (caught) {
      setError(getErrorMessage(caught, "运行定时任务失败"));
    } finally {
      setIsRunningScheduledTask(false);
    }
  }

  async function deleteScheduledTaskById(scheduleId: string) {
    const response = await fetch(`/api/scheduled-tasks/${scheduleId}`, { method: "DELETE" });
    if (response.ok) await refreshScheduledTasks();
  }

  async function runSandboxSelfTest() {
    setIsRunningSandboxTest(true);
    setSandboxSelfTest(null);
    try {
      const response = await fetch("/api/sandbox/self-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await readJson<SandboxSelfTestResult>(response);
      setSandboxSelfTest(data);
      await refreshSandboxStatus();
    } catch (caught) {
      setSandboxSelfTest({
        ok: false,
        error: getErrorMessage(caught, "沙盒自检失败")
      });
    } finally {
      setIsRunningSandboxTest(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitTask();
  }

  async function saveActiveTaskAsTemplate() {
    if (!activeTask) return;
    const response = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: getUserVisiblePrompt(activeTask.prompt).slice(0, 36),
        description: "从历史任务保存",
        promptTemplate: activeTask.prompt,
        defaultModel: activeTask.model,
        tags: ["library"]
      })
    });
    if (response.ok) {
      await refreshTemplates();
    }
  }

  async function deleteTemplate(templateId: string) {
    const response = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
    if (response.ok) {
      await refreshTemplates();
    }
  }

  async function publishTemplateToMarketplace(templateId: string) {
    const response = await fetch(`/api/templates/${templateId}/publish`, { method: "POST" });
    if (!response.ok) {
      const data = await readJson<{ error?: string }>(response, {});
      setError(data.error ?? "模板发布审核未通过");
      await refreshTemplates();
      return;
    }
    await refreshTemplates();
    await refreshMarketplaceTemplates(marketplaceSort);
  }

  async function forkMarketplaceTemplate(templateId: string) {
    setIsForkingTemplate(true);
    try {
      const response = await fetch(`/api/marketplace/templates/${templateId}/fork`, { method: "POST" });
      if (!response.ok) {
        const data = await readJson<{ error?: string }>(response, {});
        setError(data.error ?? "Fork 模板失败");
        return;
      }
      await refreshTemplates();
      await refreshMarketplaceTemplates(marketplaceSort);
    } finally {
      setIsForkingTemplate(false);
    }
  }

  async function rateMarketplaceTemplate(templateId: string, rating: number) {
    const response = await fetch(`/api/marketplace/templates/${templateId}/rating`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating })
    });
    if (response.ok) {
      await refreshMarketplaceTemplates(marketplaceSort);
    }
  }

  async function toggleSkill(skillId: string, enabled: boolean) {
    const response = await fetch("/api/skills", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId, enabled })
    });
    if (response.ok) {
      const data = await readJson<{ skills: AgentSkill[] }>(response, { skills: [] });
      setSkills(data.skills);
    }
  }

  async function uploadSkillZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploadingSkill(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/skills/upload", {
        method: "POST",
        body: formData
      });
      const data = await readJson<{ skills?: AgentSkill[]; error?: string }>(response, {});
      if (!response.ok || !data.skills) {
        throw new Error(data.error ?? "Skill 上传失败");
      }
      setSkills(data.skills.length > 0 ? data.skills : defaultSkills);
    } catch (caught) {
      setError(getErrorMessage(caught, "Skill 上传失败"));
    } finally {
      setIsUploadingSkill(false);
    }
  }

  async function addMcpServer() {
    setIsAddingMcp(true);
    setMcpError(null);
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mcpDraft.name,
          type: mcpDraft.type,
          url: mcpDraft.url,
          command: mcpDraft.command,
          args: mcpDraft.args.split(/\s+/).map((item) => item.trim()).filter(Boolean),
          env: parseEnvDraft(mcpDraft.env)
        })
      });
      const data = await readJson<{ servers?: McpServer[]; error?: string }>(response, {});
      if (!response.ok || !data.servers) {
        throw new Error(data.error ?? "MCP Server 添加失败");
      }
      setMcpServers(data.servers);
      setMcpDraft((current) => ({ ...current, name: "", url: "", args: "", env: "" }));
    } catch (caught) {
      setMcpError(getErrorMessage(caught, "MCP Server 添加失败"));
    } finally {
      setIsAddingMcp(false);
    }
  }

  function applyMcpCatalogItem(item: McpCatalogItem) {
    setMcpError(null);
    setMcpDraft({
      name: item.name,
      type: item.type,
      url: item.url ?? "",
      command: item.command ?? "",
      args: item.args.join(" "),
      env: item.envTemplate.map((key) => `${key}=`).join("\n")
    });
  }

  async function toggleMcpServer(serverId: string, enabled: boolean) {
    const response = await fetch("/api/mcp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, enabled })
    });
    if (response.ok) {
      const data = await readJson<{ servers: McpServer[] }>(response, { servers: [] });
      setMcpServers(data.servers);
    }
  }

  async function deleteMcpServer(serverId: string) {
    const response = await fetch("/api/mcp", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId })
    });
    if (response.ok) {
      const data = await readJson<{ servers: McpServer[] }>(response, { servers: [] });
      setMcpServers(data.servers);
    }
  }

  async function refreshMcpServerTools(serverId: string) {
    setMcpError(null);
    const response = await fetch(`/api/mcp/${serverId}/tools`, {
      method: "POST"
    });
    const data = await readJson<{ servers?: McpServer[]; error?: string }>(response, {});
    if (!response.ok || !data.servers) {
      setMcpError(data.error ?? "MCP 工具列表刷新失败");
      return;
    }
    setMcpServers(data.servers);
  }

  async function toggleMcpTool(serverId: string, toolName: string, enabled: boolean) {
    const response = await fetch("/api/mcp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, toolName, toolEnabled: enabled })
    });
    const data = await readJson<{ servers?: McpServer[]; error?: string }>(response, {});
    if (!response.ok || !data.servers) {
      setMcpError(data.error ?? "MCP 工具启停失败");
      return;
    }
    setMcpServers(data.servers);
  }

  function useTemplate(template: TaskTemplate) {
    setActiveTask(null);
    setActiveNav("workspace");
    const variables = extractTemplateVariables(template.promptTemplate);
    if (variables.length > 0) {
      setTemplateRun({
        template,
        variables,
        values: Object.fromEntries(variables.map((variable) => [variable, ""]))
      });
      return;
    }
    setTemplateRun(null);
    setPrompt(template.promptTemplate);
  }

  async function submitTemplateRun() {
    if (!templateRun) return;
    const renderedPrompt = renderPromptTemplate(templateRun.template.promptTemplate, templateRun.values);
    setTemplateRun(null);
    setPrompt(renderedPrompt);
    await submitTask(renderedPrompt);
  }

  function resetPageScroll() {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function navigateTo(view: NavigationView) {
    setActiveNav(view);

    if (view === "workspace") {
      setActiveTask(null);
      resetPageScroll();
      return;
    }

    if (view === "agent") {
      if (!activeTask && tasks[0]) void selectTask(tasks[0].id);
      resetPageScroll();
      return;
    }

    if (view === "library") {
      resetPageScroll();
      return;
    }

    resetPageScroll();
  }

  function navButtonClass(view: NavigationView) {
    return `nav-button ${activeNav === view ? "is-active" : ""}`;
  }

  function panelSectionClass(view: NavigationView) {
    return `panel-section ${activeNav === view ? "is-focused" : ""}`;
  }

  function renderTaskLibrary(limit = 12) {
    if (tasks.length === 0) {
      return <p className="muted-note">还没有历史任务，先从工作台创建一个新任务。</p>;
    }

    return (
      <div className="task-library-list">
        {tasks.slice(0, limit).map((task) => (
          <button
            key={task.id}
            type="button"
            className={`task-library-item ${activeTask?.id === task.id ? "is-active" : ""}`}
            onClick={() => {
              setActiveNav("agent");
              void selectTask(task.id);
            }}
          >
            <span className={`status-dot ${task.status}`} />
            <span>
              <strong>{getUserVisiblePrompt(task.prompt)}</strong>
              <small>
                {statusText[task.status]} · {task.model} · {formatDate(task.createdAt)}
              </small>
            </span>
          </button>
        ))}
      </div>
    );
  }

  function renderUploadedFileLibrary(limit = 12) {
    if (libraryFiles.length === 0) {
      return <p className="muted-note">还没有上传文件。桌面端同步或聊天框上传的文件会出现在这里。</p>;
    }

    return (
      <div className="file-library-list">
        {libraryFiles.slice(0, limit).map((file) => {
          const expiresAt = file.expiresAt ? formatDate(file.expiresAt) : "未设置 TTL";
          const source = file.metadata.source === "desktop-sync" ? "My Computer" : "Web Upload";
          return (
            <div key={file.id} className="file-library-item">
              <span className="file-library-icon">
                <FileText size={15} />
              </span>
              <span>
                <strong>{file.name}</strong>
                <small>
                  {source} · {formatSize(file.size)} · {expiresAt}
                </small>
                <em>{file.summary}</em>
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  function renderTemplatePanel() {
    return (
      <>
        <TemplateList
          templates={visibleTemplates}
          allTags={templateTags}
          activeTag={templateTagFilter}
          onTagChange={setTemplateTagFilter}
          canSave={activeTask?.status === "completed"}
          onSave={() => void saveActiveTaskAsTemplate()}
          onUse={useTemplate}
          onPublish={(templateId) => void publishTemplateToMarketplace(templateId)}
          onDelete={(templateId) => void deleteTemplate(templateId)}
        />
        <TemplateVariablePanel
          run={templateRun}
          onChange={(name, value) =>
            setTemplateRun((current) =>
              current
                ? {
                    ...current,
                    values: { ...current.values, [name]: value }
                  }
                : current
            )
          }
          onSubmit={() => void submitTemplateRun()}
          onCancel={() => setTemplateRun(null)}
        />
      </>
    );
  }

  function renderMarketplacePanel() {
    return (
      <MarketplaceTemplateList
        templates={marketplaceTemplates}
        sort={marketplaceSort}
        isForking={isForkingTemplate}
        onSortChange={setMarketplaceSort}
        onUse={useTemplate}
        onFork={(templateId) => void forkMarketplaceTemplate(templateId)}
        onRate={(templateId, rating) => void rateMarketplaceTemplate(templateId, rating)}
      />
    );
  }

  function renderOrganizationPanel() {
    const manager = activeOrganization?.role === "owner" || activeOrganization?.role === "admin";
    return (
      <div className="org-panel">
        <div className="org-toolbar">
          <label className="settings-field">
            <span>当前空间</span>
            <select
              value={activeOrgId}
              onChange={(event) => setActiveOrgId(event.target.value)}
            >
              <option value="">个人私有</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name} · {organizationRoleText[organization.role ?? "member"]}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>新组织</span>
            <input
              value={orgDraft.name}
              onChange={(event) => setOrgDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如：增长团队"
            />
          </label>
          <label className="settings-field">
            <span>任务配额</span>
            <input
              inputMode="numeric"
              value={orgDraft.taskQuota}
              onChange={(event) => setOrgDraft((current) => ({ ...current, taskQuota: event.target.value }))}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={!orgDraft.name.trim() || isCreatingOrg}
            onClick={() => void createOrganizationFromDraft()}
          >
            {isCreatingOrg ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
            创建组织
          </button>
        </div>

        <div className="org-accept-row">
          <label className="settings-field">
            <span>接受邀请链接或 Token</span>
            <input
              value={orgDraft.acceptToken}
              onChange={(event) => {
                setOrgAcceptNotice(null);
                setOrgDraft((current) => ({ ...current, acceptToken: event.target.value }));
              }}
              placeholder="粘贴 ?inviteToken=... 链接或 token"
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={!orgDraft.acceptToken.trim() || isAcceptingOrgInvite}
            onClick={() => void acceptOrganizationInvitationFromToken(orgDraft.acceptToken)}
          >
            {isAcceptingOrgInvite ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
            接受邀请
          </button>
        </div>

        {orgAcceptNotice ? <p className="muted-note">{orgAcceptNotice}</p> : null}

        {activeOrganization ? (
          <>
            <div className="library-stats org-stats">
              <div className="stat-box">
                <div className="stat-value">{organizationRoleText[activeOrganization.role ?? "member"]}</div>
                <div className="stat-label">我的角色</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{activeOrganization.taskCount}/{activeOrganization.taskQuota}</div>
                <div className="stat-label">任务配额</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{orgMembers.length}</div>
                <div className="stat-label">成员</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{orgTasks.length}</div>
                <div className="stat-label">共享任务</div>
              </div>
            </div>

            {manager ? (
              <div className="org-toolbar">
                <label className="settings-field">
                  <span>邀请手机号</span>
                  <input
                    inputMode="tel"
                    value={orgDraft.invitePhone}
                    onChange={(event) => {
                      setOrgInviteResult(null);
                      setOrgDraft((current) => ({ ...current, invitePhone: event.target.value }));
                    }}
                    placeholder="请输入 11 位手机号"
                  />
                </label>
                <label className="settings-field">
                  <span>角色</span>
                  <select
                    value={orgDraft.inviteRole}
                    onChange={(event) =>
                      setOrgDraft((current) => ({
                        ...current,
                        inviteRole: event.target.value as Exclude<OrganizationRole, "owner">
                      }))
                    }
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!orgDraft.invitePhone.trim() || isInvitingOrgMember}
                  onClick={() => void inviteOrganizationMember()}
                >
                  {isInvitingOrgMember ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
                  邀请
                </button>
              </div>
            ) : null}

            {orgInviteResult ? (
              <div className="org-invite-result">
                <div>
                  <strong>{orgInviteResult.phone}</strong>
                  <span>
                    {organizationRoleText[orgInviteResult.role]} 邀请已生成，复制接受链接给对方登录后打开。
                  </span>
                </div>
                <code>{orgInviteResult.acceptUrl || orgInviteResult.token}</code>
              </div>
            ) : null}

            <div className="view-grid two-columns">
              <div className="metric-list compact">
                {orgMembers.length ? (
                  orgMembers.slice(0, 8).map((member) => {
                    const canManageMember =
                      manager &&
                      member.role !== "owner" &&
                      member.userId !== authUser?.id &&
                      (activeOrganization?.role === "owner" || member.role !== "admin");
                    const isManagingMember = managingOrgMemberId === member.userId;
                    return (
                      <div key={`${member.orgId}-${member.userId}`} className="metric-item org-member-row">
                        <div>
                          <span className="metric-name">{member.user?.displayName ?? member.userId}</span>
                          <span className="metric-meta">{member.user?.phone ?? member.user?.email ?? member.userId}</span>
                        </div>
                        <div className="org-member-actions">
                          {canManageMember ? (
                            <select
                              className="member-role-select"
                              aria-label={`修改 ${member.user?.displayName ?? member.userId} 的组织角色`}
                              value={member.role}
                              disabled={Boolean(managingOrgMemberId)}
                              onChange={(event) =>
                                void updateOrganizationMember(
                                  member,
                                  event.target.value as Exclude<OrganizationRole, "owner">
                                )
                              }
                            >
                              <option value="admin">Admin</option>
                              <option value="member">Member</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          ) : (
                            <strong>{organizationRoleText[member.role]}</strong>
                          )}
                          {canManageMember ? (
                            <button
                              type="button"
                              className="icon-button org-remove-button"
                              aria-label={`移除 ${member.user?.displayName ?? member.userId}`}
                              title="移除成员"
                              disabled={Boolean(managingOrgMemberId)}
                              onClick={() => void removeOrganizationMemberFromOrg(member)}
                            >
                              {isManagingMember ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="muted-note">暂无成员数据。</p>
                )}
              </div>
              <div className="task-library-list">
                {orgTasks.length ? (
                  orgTasks.slice(0, 8).map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className={`task-library-item ${activeTask?.id === task.id ? "is-active" : ""}`}
                      onClick={() => {
                        setActiveNav("agent");
                        void selectTask(task.id);
                      }}
                    >
                      <span className={`status-dot ${task.status}`} />
                      <span>
                        <strong>{getUserVisiblePrompt(task.prompt)}</strong>
                        <small>{statusText[task.status]} · {formatDate(task.createdAt)}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="muted-note">当前组织还没有共享任务。</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="muted-note">选择组织后，新任务会以组织可见性创建；选择“个人私有”则只保存到当前账号。</p>
        )}
      </div>
    );
  }

  function renderSettingsControls() {
    return (
      <div className="settings-grid">
        <label className="settings-field">
          <span>模型</span>
          <input
            value={settingsDraft.model}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, model: event.target.value }))
            }
          />
        </label>
        <label className="settings-field">
          <span>接口</span>
          <input
            value={settingsDraft.baseUrl}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, baseUrl: event.target.value }))
            }
          />
        </label>
        <label className="settings-field">
          <span>温度</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={settingsDraft.temperature}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, temperature: event.target.value }))
            }
          />
        </label>
        <label className="settings-field">
          <span>最大步骤</span>
          <input
            type="number"
            min="3"
            max="12"
            step="1"
            value={settingsDraft.maxSteps}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, maxSteps: event.target.value }))
            }
          />
        </label>
        <label className="settings-field">
          <span>单任务预算 USD</span>
          <input
            type="number"
            min="0"
            step="0.05"
            value={settingsDraft.taskBudgetUsd}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, taskBudgetUsd: event.target.value }))
            }
          />
        </label>
        <label className="settings-field">
          <span>规划模型</span>
          <input
            value={settingsDraft.planningModel}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, planningModel: event.target.value }))
            }
          />
        </label>
        <label className="settings-field">
          <span>执行模型</span>
          <input
            value={settingsDraft.executionModel}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, executionModel: event.target.value }))
            }
          />
        </label>
        <label className="settings-field">
          <span>总结模型</span>
          <input
            value={settingsDraft.finalModel}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, finalModel: event.target.value }))
            }
          />
        </label>
        <label className="setting-row checkbox-row">
          <span>Prompt Cache</span>
          <input
            type="checkbox"
            checked={settingsDraft.promptCacheEnabled}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                promptCacheEnabled: event.target.checked
              }))
            }
          />
        </label>
        <label className="settings-field">
          <span>图片 Provider</span>
          <select
            value={settingsDraft.designImageProvider}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, designImageProvider: event.target.value }))
            }
          >
            <option value="local">Local 生成</option>
            <option value="dall-e-3">DALL-E 3</option>
            <option value="stable-diffusion">Stable Diffusion</option>
            <option value="tongyi-wanxiang">通义万相</option>
            <option value="wenxin-yige">文心一格</option>
          </select>
        </label>
        <label className="settings-field">
          <span>图片上限</span>
          <input
            type="number"
            min="1"
            max="20"
            step="1"
            value={settingsDraft.designImageMaxPerTask}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, designImageMaxPerTask: event.target.value }))
            }
          />
        </label>
        <label className="settings-field">
          <span>图片 API Key</span>
          <input
            type="password"
            value={settingsDraft.designImageApiKey}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, designImageApiKey: event.target.value }))
            }
            placeholder={config?.hasDesignImageApiKey ? "已配置，输入新 key 可覆盖" : "本地生成无需填写"}
          />
        </label>
        <label className="settings-field">
          <span>API Key</span>
          <input
            type="password"
            value={settingsDraft.apiKey}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, apiKey: event.target.value }))
            }
            placeholder={config?.hasApiKey ? "已配置，输入新 key 可覆盖" : "未配置"}
          />
        </label>
        <button
          type="button"
          className="secondary-button settings-save"
          disabled={isSavingSettings}
          onClick={() => void saveSettings()}
        >
          {isSavingSettings ? "保存中" : "保存配置"}
        </button>
      </div>
    );
  }

  function renderModelRouterOptimizerPanel() {
    if (!routerOptimizer) {
      return (
        <div className="router-optimizer empty-state-inline">
          <p>还没有路由优化数据。创建几个任务后，这里会根据 Context 指标推荐模型组合。</p>
          <button type="button" className="secondary-button compact-button" onClick={() => void refreshRouterOptimizer()}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      );
    }

    const policyRows = [
      routerOptimizer.recommendation.policy.planning,
      routerOptimizer.recommendation.policy.execution,
      routerOptimizer.recommendation.policy.finalAnswer
    ];
    const stageLabel: Record<string, string> = {
      planning: "规划",
      execution: "执行",
      final_answer: "总结"
    };
    const ab = routerOptimizer.abTest;

    return (
      <div className="router-optimizer">
        <div className="router-summary">
          <div>
            <span className="mini-label">当前识别</span>
            <strong>{routerOptimizer.selectedLabel}</strong>
            <small>
              {routerOptimizer.currentPolicy.manualOverride ? "手动覆盖已生效" : "自动优化可接管默认模型"}
              {" · "}
              {routerOptimizer.latencyMs}ms
            </small>
          </div>
          <div className="router-actions">
            <button type="button" className="secondary-button compact-button" onClick={() => void refreshRouterOptimizer(prompt)}>
              <RefreshCw size={14} />
              刷新
            </button>
            <button
              type="button"
              className="primary-button compact-button"
              disabled={isApplyingRouterPolicy}
              onClick={() => void applyRouterRecommendation()}
            >
              <Sparkles size={14} />
              {isApplyingRouterPolicy ? "应用中" : "应用推荐"}
            </button>
          </div>
        </div>

        <div className="router-policy-grid">
          {policyRows.map((item) => (
            <div className="router-policy-item" key={item.stage}>
              <span className="mini-label">{stageLabel[item.stage]}</span>
              <strong>{item.model}</strong>
              <small>
                {item.source === "history" ? `${item.sampleSize} 个样本` : "规则回退"}
                {" · "}
                置信度 {formatPercent(item.confidence)}
              </small>
            </div>
          ))}
        </div>

        <div className="router-ab">
          <div>
            <span className="mini-label">A/B 回放</span>
            <strong>
              {ab.winner === "candidate"
                ? `推荐策略预计节省 ${formatPercent(ab.costSavingsRate)}`
                : ab.winner === "baseline"
                  ? "当前策略更稳"
                  : "样本不足"}
            </strong>
            <small>
              样本 {ab.sampleSize} 个 · 当前 {formatUsd(ab.baselineCostUsd)} · 推荐 {formatUsd(ab.candidateCostUsd)}
            </small>
          </div>
          <div className="router-quality">
            <span>{ab.baselineQualityScore.toFixed(1)}</span>
            <small>当前质量分</small>
            <span>{ab.candidateQualityScore.toFixed(1)}</span>
            <small>推荐质量分</small>
          </div>
        </div>

        {routerOptimizer.fallbackReason ? (
          <p className="muted-note">{routerOptimizer.fallbackReason}</p>
        ) : null}
      </div>
    );
  }

  function renderLibraryView() {
    return (
      <div className="view-page">
        <div className="view-header">
          <div>
            <div className="empty-kicker">Library</div>
            <h1>任务资产库</h1>
            <p>集中管理历史任务、可复用模板、交付物线索和本月模型成本。</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => navigateTo("workspace")}>
            <Plus size={15} />
            新任务
          </button>
        </div>

        <div className="library-stats view-stats">
          <div className="stat-box">
            <div className="stat-value">{tasks.length}</div>
            <div className="stat-label">总任务</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{runningTaskCount}</div>
            <div className="stat-label">运行中</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{completedTaskCount}</div>
            <div className="stat-label">已完成</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{templates.length}</div>
            <div className="stat-label">模板</div>
          </div>
        </div>

        <section className="section-panel">
          <div className="panel-title">
            <ShieldCheck size={14} />
            组织协作
          </div>
          {renderOrganizationPanel()}
        </section>

        <div className="view-grid two-columns">
          <section className="section-panel">
            <div className="panel-title">历史任务</div>
            {renderTaskLibrary(16)}
          </section>
          <section className="section-panel">
            <div className="panel-title">
              <FileText size={14} />
              上传文件
            </div>
            {renderUploadedFileLibrary(16)}
          </section>
        </div>

        <div className="view-grid two-columns">
          <section className="section-panel">
            <div className="panel-title">
              <BookmarkPlus size={14} />
              模板
            </div>
            {renderTemplatePanel()}
          </section>
          <section className="section-panel">
            <div className="panel-title">
              <FileSpreadsheet size={14} />
              Billing
            </div>
            <BillingPanel summary={billingSummary} />
          </section>
        </div>

        <section className="section-panel">
          <div className="panel-title">
            <Sparkles size={14} />
            模板市场
          </div>
          {renderMarketplacePanel()}
        </section>

      </div>
    );
  }

  function renderSettingsView() {
    return (
      <div className="view-page">
        <div className="view-header">
          <div>
            <div className="empty-kicker">Settings</div>
            <h1>系统设置</h1>
            <p>配置模型、预算、Skills、MCP Server 和 Agent 可调用能力。</p>
          </div>
          <span className="status-chip">
            {config?.hasApiKey ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
            {config?.hasApiKey ? "API Key 已配置" : "使用本地回退"}
          </span>
        </div>

        <div className="settings-page-grid">
          <section className="section-panel settings-model-panel">
            <div className="panel-title">模型与预算</div>
            {renderSettingsControls()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <Gauge size={14} />
              模型路由优化
            </div>
            {renderModelRouterOptimizerPanel()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <CheckCircle2 size={14} />
              认证
            </div>
            {renderAuthPanel()}
          </section>

          <section className="section-panel settings-model-panel">
            <div className="panel-title">
              <ShieldCheck size={14} />
              组织与权限
            </div>
            {renderOrganizationPanel()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <Database size={14} />
              数据库
            </div>
            {renderDatabasePanel()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <ShieldCheck size={14} />
              审计日志
            </div>
            {renderAuditPanel()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <Bell size={14} />
              通知
            </div>
            {renderNotificationPanel()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <Clock3 size={14} />
              Scheduled / Mail / Slack
            </div>
            {renderScheduledTaskPanel()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <SquareTerminal size={14} />
              沙盒
            </div>
            {renderSandboxPanel()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <Globe size={14} />
              本地浏览器
            </div>
            {renderLocalBrowserPanel()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <Home size={14} />
              My Computer
            </div>
            {renderMyComputerPanel()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <FileText size={14} />
              OCR
            </div>
            {renderOcrPanel()}
          </section>

          <section className="section-panel">
            <div className="panel-title">
              <Brain size={14} />
              Skills
            </div>
            <input
              ref={skillInputRef}
              className="hidden-file-input"
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => void uploadSkillZip(event)}
            />
            <SkillList
              skills={skills}
              isUploading={isUploadingSkill}
              onUpload={() => skillInputRef.current?.click()}
              onToggle={(skillId, enabled) => void toggleSkill(skillId, enabled)}
            />
          </section>

          <section className="section-panel settings-mcp-panel">
            <div className="panel-title">
              <SquareTerminal size={14} />
              MCP Servers
            </div>
            <McpServerPanel
              servers={mcpServers}
              catalog={mcpCatalog}
              draft={mcpDraft}
              error={mcpError}
              isAdding={isAddingMcp}
              onDraftChange={(patch) => setMcpDraft((current) => ({ ...current, ...patch }))}
              onApplyCatalog={applyMcpCatalogItem}
              onAdd={() => void addMcpServer()}
              onToggle={(serverId, enabled) => void toggleMcpServer(serverId, enabled)}
              onDelete={(serverId) => void deleteMcpServer(serverId)}
              onRefresh={(serverId) => void refreshMcpServerTools(serverId)}
              onToolToggle={(serverId, toolName, enabled) => void toggleMcpTool(serverId, toolName, enabled)}
            />
          </section>
        </div>
      </div>
    );
  }

  function renderAgentEmptyView() {
    return (
      <div className="view-page">
        <div className="view-header">
          <div>
            <div className="empty-kicker">Agent</div>
            <h1>选择一个任务查看执行过程。</h1>
            <p>Agent 页面用于查看计划、工具调用、步骤流、Context 指标和交付物。</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => navigateTo("workspace")}>
            <Plus size={15} />
            创建任务
          </button>
        </div>
        <section className="section-panel">
          <div className="panel-title">最近任务</div>
          {renderTaskLibrary(10)}
        </section>
      </div>
    );
  }

  function renderAuthPanel() {
    const configuredOauth = authStatus?.oauth.filter((provider) => provider.configured).length ?? 0;
    const emailMeta = authStatus
      ? authStatus.email.mode === "smtp"
        ? `${authStatus.email.host ?? "smtp"}:${authStatus.email.port ?? "-"} · ${authStatus.email.from ?? "from unset"}`
        : "development code display"
      : "检查中";
    const accessDays = authStatus ? Math.round(authStatus.session.accessMaxAgeSeconds / 86400) : 0;
    const refreshDays = authStatus ? Math.round(authStatus.session.refreshMaxAgeSeconds / 86400) : 0;

    return (
      <div className="sandbox-panel">
        <div className="metric-list compact">
          <div className="metric-item">
            <div>
              <span className="metric-name">邮箱验证</span>
              <span className="metric-meta">{emailMeta}</span>
            </div>
            <strong>{authStatus?.email.configured ? "smtp" : "local"}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">验证码</span>
              <span className="metric-meta">
                {authStatus?.email.verificationCodeExposed
                  ? "开发模式会在页面直接显示验证码"
                  : "生产模式不暴露验证码"}
              </span>
            </div>
            <strong>{authStatus?.email.verificationCodeExposed ? "visible" : "hidden"}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">OAuth</span>
              <span className="metric-meta">{authStatus?.baseUrl ?? "检查中"}</span>
            </div>
            <strong>{configuredOauth}/2</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">Session</span>
              <span className="metric-meta">
                access {accessDays || "-"}d · refresh {refreshDays || "-"}d
              </span>
            </div>
            <strong>{authStatus?.session.cookieSecure ? "secure" : "dev"}</strong>
          </div>
        </div>
        {authStatus?.oauth.length ? (
          <div className="browser-operation-list">
            {authStatus.oauth.map((provider) => (
              <div className="browser-operation-item" key={provider.provider}>
                <div>
                  <span>{provider.provider}</span>
                  <small>
                    {provider.configured
                      ? provider.callbackUrl
                      : `缺少 ${provider.missing.slice(0, 2).join(" / ")}`}
                  </small>
                </div>
                <strong className={`operation-status ${provider.configured ? "is-completed" : "is-blocked"}`}>
                  {provider.configured ? "ready" : "unset"}
                </strong>
              </div>
            ))}
          </div>
        ) : null}
        <div className="panel-actions">
          <button type="button" className="secondary-button" onClick={() => void refreshAuthStatus()}>
            <RefreshCw size={15} />
            刷新认证
          </button>
        </div>
      </div>
    );
  }

  function renderAuditPanel() {
    const verifyLabel = auditVerify ? (auditVerify.ok ? "verified" : "broken") : "checking";
    const lastHash = auditVerify?.lastHash ? auditVerify.lastHash.slice(0, 12) : "-";

    return (
      <div className="sandbox-panel">
        <div className="metric-list compact">
          <div className="metric-item">
            <div>
              <span className="metric-name">Hash Chain</span>
              <span className="metric-meta">
                {auditVerify?.error ?? `last ${lastHash}`}
              </span>
            </div>
            <strong>{verifyLabel}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">记录数</span>
              <span className="metric-meta">
                {auditVerify?.checkedAt
                  ? new Date(auditVerify.checkedAt).toLocaleTimeString()
                  : "等待校验"}
              </span>
            </div>
            <strong>{auditVerify?.total ?? auditLogs.length}</strong>
          </div>
        </div>
        {auditLogs.length ? (
          <div className="browser-operation-list">
            {auditLogs.map((log) => (
              <div className="browser-operation-item" key={log.id}>
                <div>
                  <span>{log.action}</span>
                  <small>
                    {log.resource} · {log.taskId ?? "no-task"} · {new Date(log.createdAt).toLocaleTimeString()}
                  </small>
                </div>
                <strong className={`operation-status is-${log.status}`}>{log.status}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-note">暂无审计记录。</p>
        )}
        <div className="panel-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isRefreshingAudit}
            onClick={() => void refreshAudit()}
          >
            {isRefreshingAudit ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            刷新审计
          </button>
          <a className="secondary-button" href="/api/audit/logs?format=csv&limit=200">
            <Download size={15} />
            导出 CSV
          </a>
        </div>
      </div>
    );
  }

  function renderNotificationPanel() {
    const enabledChannels = [
      notificationSettings?.emailEnabled ? "Email" : null,
      notificationSettings?.webhookEnabled ? "Webhook" : null,
      notificationSettings?.slackEnabled ? "Slack" : null
    ].filter(Boolean);

    return (
      <div className="sandbox-panel">
        <div className="metric-list compact">
          <div className="metric-item">
            <div>
              <span className="metric-name">渠道</span>
              <span className="metric-meta">任务完成/失败后异步发送，不阻塞 Agent。</span>
            </div>
            <strong>{enabledChannels.length ? enabledChannels.join("+") : "off"}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">触发</span>
              <span className="metric-meta">
                completed {notificationSettings?.notifyOnCompleted ? "on" : "off"} · failed{" "}
                {notificationSettings?.notifyOnFailed ? "on" : "off"}
              </span>
            </div>
            <strong>{notificationLogs.length}</strong>
          </div>
        </div>

        <div className="settings-grid notification-grid">
          <label className="setting-row checkbox-row">
            <span>Email</span>
            <input
              type="checkbox"
              checked={notificationDraft.emailEnabled}
              onChange={(event) =>
                setNotificationDraft((current) => ({ ...current, emailEnabled: event.target.checked }))
              }
            />
          </label>
          <label className="setting-row checkbox-row">
            <span>完成时通知</span>
            <input
              type="checkbox"
              checked={notificationDraft.notifyOnCompleted}
              onChange={(event) =>
                setNotificationDraft((current) => ({
                  ...current,
                  notifyOnCompleted: event.target.checked
                }))
              }
            />
          </label>
          <label className="setting-row checkbox-row">
            <span>失败时通知</span>
            <input
              type="checkbox"
              checked={notificationDraft.notifyOnFailed}
              onChange={(event) =>
                setNotificationDraft((current) => ({ ...current, notifyOnFailed: event.target.checked }))
              }
            />
          </label>
          <label className="setting-row checkbox-row">
            <span>Webhook</span>
            <input
              type="checkbox"
              checked={notificationDraft.webhookEnabled}
              onChange={(event) =>
                setNotificationDraft((current) => ({ ...current, webhookEnabled: event.target.checked }))
              }
            />
          </label>
          <label className="settings-field">
            <span>Webhook URL</span>
            <input
              value={notificationDraft.webhookUrl}
              onChange={(event) =>
                setNotificationDraft((current) => ({ ...current, webhookUrl: event.target.value }))
              }
              placeholder="https://example.com/manusxl-webhook"
            />
          </label>
          <label className="setting-row checkbox-row">
            <span>Slack</span>
            <input
              type="checkbox"
              checked={notificationDraft.slackEnabled}
              onChange={(event) =>
                setNotificationDraft((current) => ({ ...current, slackEnabled: event.target.checked }))
              }
            />
          </label>
          <label className="settings-field">
            <span>Slack Webhook</span>
            <input
              value={notificationDraft.slackWebhookUrl}
              onChange={(event) =>
                setNotificationDraft((current) => ({ ...current, slackWebhookUrl: event.target.value }))
              }
              placeholder="https://hooks.slack.com/services/..."
            />
          </label>
        </div>

        {notificationLogs.length ? (
          <div className="browser-operation-list">
            {notificationLogs.slice(0, 6).map((log) => (
              <div className="browser-operation-item" key={log.id}>
                <div>
                  <span>{log.title}</span>
                  <small>
                    {log.channel} · {log.status} · {new Date(log.createdAt).toLocaleTimeString()}
                  </small>
                </div>
                <strong className={`operation-status is-${log.status === "failed" ? "failed" : "completed"}`}>
                  {log.status}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-note">暂无通知记录。</p>
        )}

        <div className="panel-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isSavingNotifications}
            onClick={() => void saveNotificationSettings()}
          >
            {isSavingNotifications ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
            保存通知
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isTestingNotifications}
            onClick={() => void sendNotificationTest("completed")}
          >
            {isTestingNotifications ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
            测试完成通知
          </button>
        </div>
      </div>
    );
  }

  function renderScheduledTaskPanel() {
    const activeCount = scheduledTasks.filter((task) => task.status === "active").length;

    return (
      <div className="sandbox-panel">
        <div className="metric-list compact">
          <div className="metric-item">
            <div>
              <span className="metric-name">Mail Manus 地址</span>
              <span className="metric-meta">{scheduledMailbox || "登录后生成"}</span>
            </div>
            <strong>{scheduledMailbox ? "ready" : "local"}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">计划任务</span>
              <span className="metric-meta">定时器会创建新任务并进入现有 Agent 队列。</span>
            </div>
            <strong>{activeCount}/{scheduledTasks.length}</strong>
          </div>
        </div>

        <div className="settings-grid notification-grid">
          <label className="settings-field">
            <span>名称</span>
            <input
              value={scheduledDraft.name}
              onChange={(event) => setScheduledDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="每周竞品简报"
            />
          </label>
          <label className="settings-field">
            <span>模式</span>
            <select
              value={scheduledDraft.kind}
              onChange={(event) =>
                setScheduledDraft((current) => ({
                  ...current,
                  kind: event.target.value as ScheduledTaskKind
                }))
              }
            >
              <option value="interval">Interval</option>
              <option value="cron">Cron</option>
            </select>
          </label>
          {scheduledDraft.kind === "interval" ? (
            <label className="settings-field">
              <span>间隔分钟</span>
              <input
                type="number"
                min="0.02"
                step="0.1"
                value={scheduledDraft.intervalMinutes}
                onChange={(event) =>
                  setScheduledDraft((current) => ({ ...current, intervalMinutes: event.target.value }))
                }
              />
            </label>
          ) : (
            <label className="settings-field">
              <span>Cron 表达式</span>
              <input
                value={scheduledDraft.cronExpression}
                onChange={(event) =>
                  setScheduledDraft((current) => ({ ...current, cronExpression: event.target.value }))
                }
                placeholder="0 9 * * 1"
              />
            </label>
          )}
          <label className="settings-field wide-field">
            <span>Prompt</span>
            <textarea
              value={scheduledDraft.prompt}
              onChange={(event) => setScheduledDraft((current) => ({ ...current, prompt: event.target.value }))}
              placeholder="每周一 9 点调研本周 AI Agent 行业新闻，输出简报。"
            />
          </label>
        </div>

        <div className="panel-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isCreatingScheduledTask || !scheduledDraft.prompt.trim()}
            onClick={() => void createScheduledTaskFromDraft()}
          >
            {isCreatingScheduledTask ? <Loader2 size={15} className="spin" /> : <Clock3 size={15} />}
            创建计划
          </button>
          <button type="button" className="secondary-button" onClick={() => void refreshScheduledTasks()}>
            <RefreshCw size={15} />
            刷新
          </button>
        </div>

        {scheduledTasks.length ? (
          <div className="browser-operation-list">
            {scheduledTasks.slice(0, 8).map((task) => (
              <div className="browser-operation-item" key={task.id}>
                <div>
                  <span>{task.name}</span>
                  <small>
                    {task.kind === "cron" ? task.cronExpression : `${task.intervalMinutes} min`} · next{" "}
                    {task.nextRunAt ? formatDate(task.nextRunAt) : "paused"} · runs {task.runCount}
                  </small>
                </div>
                <div className="panel-actions compact-actions">
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    disabled={isRunningScheduledTask}
                    onClick={() => void runScheduledTaskNow(task.id)}
                  >
                    <Play size={13} />
                    运行
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    onClick={() => void deleteScheduledTaskById(task.id)}
                  >
                    <Trash2 size={13} />
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-note">还没有计划任务。也可以在任务详情页把历史任务设为定时任务。</p>
        )}

        {scheduledLogs.length ? (
          <div className="browser-operation-list">
            {scheduledLogs.slice(0, 6).map((log) => (
              <div className="browser-operation-item" key={log.id}>
                <div>
                  <span>{log.source}</span>
                  <small>
                    {log.triggerType} · {log.status} · {new Date(log.createdAt).toLocaleTimeString()}
                  </small>
                </div>
                <strong className={`operation-status is-${log.status === "failed" ? "failed" : "completed"}`}>
                  {log.status}
                </strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderDatabasePanel() {
    const providerLabel = databaseStatus
      ? `${databaseStatus.requestedProvider} / ${databaseStatus.activeProvider}`
      : "loading";
    const pgStatus = databaseStatus
      ? databaseStatus.postgres.schemaReady === true
        ? "ready"
        : databaseStatus.postgres.schemaReady === false
          ? "unready"
          : databaseStatus.postgres.configured
            ? "configured"
            : "unset"
      : "loading";
    const tableSummary = databaseStatus
      ? databaseStatus.sqlite.tables
          .filter((table) => table.rows > 0)
          .slice(0, 4)
          .map((table) => `${table.table}:${table.rows}`)
          .join(" · ") || "暂无表数据"
      : "检查中";
    const pgClientLabel = databaseStatus?.postgres.cliAvailable
      ? `psql:${databaseStatus.postgres.cliSource ?? "local"}`
      : "psql:missing";
    const pgMeta = databaseStatus
      ? `${pgClientLabel} · ${
          databaseStatus.postgres.error ??
          databaseStatus.postgres.databaseUrlMasked ??
          "未配置 DATABASE_URL"
        }`
      : "检查中";

    return (
      <div className="sandbox-panel">
        <div className="metric-list compact">
          <div className="metric-item">
            <div>
              <span className="metric-name">运行模式</span>
              <span className="metric-meta">{databaseStatus?.note ?? "检查中"}</span>
            </div>
            <strong>{providerLabel}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">SQLite</span>
              <span className="metric-meta">{tableSummary}</span>
            </div>
            <strong>{databaseStatus?.sqlite.totalRows ?? 0}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">PostgreSQL</span>
              <span className="metric-meta">{pgMeta}</span>
            </div>
            <strong>{pgStatus}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">迁移命令</span>
              <span className="metric-meta">{databaseStatus?.commands.dryRun ?? "npm run db:pg:dry-run"}</span>
            </div>
            <strong>
              {databaseStatus?.postgres.schemaTableCount === undefined
                ? `${databaseStatus?.postgres.expectedTableCount ?? 10} tables`
                : `${databaseStatus.postgres.schemaTableCount}/${databaseStatus.postgres.expectedTableCount}`}
            </strong>
          </div>
        </div>
        <div className="panel-actions">
          <button type="button" className="secondary-button" onClick={() => void refreshDatabaseStatus()}>
            <RefreshCw size={15} />
            刷新状态
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isCheckingDatabase}
            onClick={() => void refreshDatabaseStatus(true)}
          >
            {isCheckingDatabase ? <Loader2 size={15} className="spin" /> : <Database size={15} />}
            检查 PG
          </button>
        </div>
      </div>
    );
  }

  function renderSandboxPanel() {
    const statusLabel = sandboxStatus
      ? sandboxStatus.mode === "local"
        ? "local"
        : sandboxStatus.dockerAvailable && sandboxStatus.imageAvailable
          ? "ready"
          : "unready"
      : "loading";

    return (
      <div className="sandbox-panel">
        <div className="metric-list compact">
          <div className="metric-item">
            <div>
              <span className="metric-name">模式</span>
              <span className="metric-meta">{sandboxStatus?.image ?? "检查中"}</span>
            </div>
            <strong>{statusLabel}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">Docker</span>
              <span className="metric-meta">
                {sandboxStatus?.reason ?? (sandboxStatus?.dockerAvailable ? "daemon available" : "waiting")}
              </span>
            </div>
            <strong>{sandboxStatus?.dockerAvailable ? "on" : "off"}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">资源限制</span>
              <span className="metric-meta">
                {sandboxStatus
                  ? `${sandboxStatus.memoryLimit} · ${sandboxStatus.cpuLimit} CPU · ${formatSize(sandboxStatus.workspaceQuotaBytes)} workspace`
                  : "检查中"}
              </span>
            </div>
            <strong>{sandboxStatus?.networkEnabled ? "net" : "no-net"}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">容器池</span>
              <span className="metric-meta">{sandboxStatus?.poolEnabled ? "task-level reuse" : "one-shot"}</span>
            </div>
            <strong>{sandboxStatus?.pool.length ?? 0}</strong>
          </div>
        </div>
        <div className="panel-actions">
          <button type="button" className="secondary-button" onClick={() => void refreshSandboxStatus()}>
            <RefreshCw size={15} />
            刷新状态
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isRunningSandboxTest}
            onClick={() => void runSandboxSelfTest()}
          >
            {isRunningSandboxTest ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            运行自检
          </button>
        </div>
        {sandboxSelfTest ? (
          <p className={`muted-note ${sandboxSelfTest.ok ? "" : "error-note"}`}>
            {sandboxSelfTest.ok
              ? `自检通过：Python ${sandboxSelfTest.python?.sandbox.mode ?? "unknown"}，Shell ${sandboxSelfTest.shell?.sandbox.mode ?? "unknown"}。`
              : sandboxSelfTest.resourceError?.message ?? sandboxSelfTest.error ?? "沙盒自检失败。"}
          </p>
        ) : null}
      </div>
    );
  }

  function renderLocalBrowserPanel() {
    const statusLabel = localBrowserStatus
      ? localBrowserStatus.connected
        ? "connected"
        : "offline"
      : "unknown";
    const detail = localBrowserStatus
      ? localBrowserStatus.connected
        ? `${localBrowserStatus.browser ?? "Chrome"} · CDP ${localBrowserStatus.protocolVersion ?? "unknown"}`
        : localBrowserStatus.error ?? "未检测到本地 Chrome CDP"
      : "尚未检测";
    const browserPaused = Boolean(localBrowserSafety?.paused ?? localBrowserStatus?.paused);
    const pendingApprovals = localBrowserSafety?.pendingApprovals ?? [];
    const recentOperations =
      localBrowserSafety?.recentOperations ?? localBrowserStatus?.recentOperations ?? [];
    const pairedDeviceCount = localBrowserPairing?.pairedDevices.length ?? 0;

    return (
      <div className="sandbox-panel">
        <div className="metric-list compact">
          <div className="metric-item">
            <div>
              <span className="metric-name">连接</span>
              <span className="metric-meta">{detail}</span>
            </div>
            <strong>{statusLabel}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">CDP 地址</span>
              <span className="metric-meta">{localBrowserStatus?.endpoint ?? localBrowserEndpoint}</span>
            </div>
            <strong>{localBrowserStatus?.webSocketDebuggerUrl ? "ws" : "http"}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">标签页</span>
              <span className="metric-meta">
                {localBrowserTabs[0]?.title || localBrowserTabs[0]?.url || "暂无可读取标签页"}
              </span>
            </div>
            <strong>{localBrowserTabs.length}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">Allowlist</span>
              <span className="metric-meta">
                {config?.localBrowserDomainAllowlist.length
                  ? config.localBrowserDomainAllowlist.slice(0, 3).join(" / ")
                  : "empty"}
              </span>
            </div>
            <strong>{config?.localBrowserDomainAllowlist.length ? "on" : "off"}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">安全开关</span>
              <span className="metric-meta">
                {browserPaused
                  ? "已暂停所有本地浏览器动作"
                  : pendingApprovals.length
                    ? `${pendingApprovals.length} 个操作等待扩展确认`
                    : "允许已授权域名动作"}
              </span>
            </div>
            <strong>{browserPaused ? "paused" : pendingApprovals.length ? "pending" : "active"}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">扩展配对</span>
              <span className="metric-meta">
                {localBrowserPairing?.activeCode
                  ? `配对码 ${localBrowserPairing.activeCode.code}`
                  : pairedDeviceCount > 0
                    ? `${pairedDeviceCount} 个扩展已配对`
                    : "尚未配对扩展"}
              </span>
            </div>
            <strong>{pairedDeviceCount > 0 ? "paired" : localBrowserPairing?.activeCode ? "code" : "none"}</strong>
          </div>
        </div>
        <label className="settings-field">
          <span>Chrome DevTools 地址</span>
          <input
            value={localBrowserEndpoint}
            onChange={(event) => setLocalBrowserEndpoint(event.target.value)}
            placeholder="http://127.0.0.1:9222"
          />
        </label>
        <label className="settings-field">
          <span>允许域名</span>
          <textarea
            value={settingsDraft.localBrowserDomainAllowlist}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                localBrowserDomainAllowlist: event.target.value
              }))
            }
            placeholder={"example.com\nnews.example.com"}
          />
        </label>
        <div className="panel-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isCheckingLocalBrowser}
            onClick={() => void refreshLocalBrowserStatus(localBrowserEndpoint)}
          >
            {isCheckingLocalBrowser ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            检测连接
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isCapturingLocalBrowser}
            onClick={() => void captureLocalBrowserScreenshot()}
          >
            {isCapturingLocalBrowser ? <Loader2 size={15} className="spin" /> : <Camera size={15} />}
            截图
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isSavingLocalBrowserAllowlist}
            onClick={() => void saveLocalBrowserAllowlist()}
          >
            {isSavingLocalBrowserAllowlist ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
            保存域名
          </button>
          <button
            type="button"
            className={browserPaused ? "secondary-button" : "danger-button"}
            disabled={isTogglingLocalBrowserPause}
            onClick={() => void toggleLocalBrowserPause(!browserPaused)}
          >
            {isTogglingLocalBrowserPause ? (
              <Loader2 size={15} className="spin" />
            ) : browserPaused ? (
              <Play size={15} />
            ) : (
              <CircleStop size={15} />
            )}
            {browserPaused ? "恢复操作" : "暂停操作"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isCreatingLocalBrowserPairing}
            onClick={() => void createLocalBrowserPairing()}
          >
            {isCreatingLocalBrowserPairing ? <Loader2 size={15} className="spin" /> : <Globe size={15} />}
            生成配对码
          </button>
          <a className="secondary-button" href="/local-browser/rehearsal" target="_blank" rel="noreferrer">
            <Globe size={15} />
            登录态演练
          </a>
        </div>
        {localBrowserPairing?.activeCode ? (
          <div className="pairing-code-panel">
            <strong>{localBrowserPairing.activeCode.code}</strong>
            <span>在 Chrome 扩展里输入此码，5 分钟内有效。</span>
          </div>
        ) : null}
        {localBrowserPairing?.pairedDevices.length ? (
          <div className="browser-operation-list">
            {localBrowserPairing.pairedDevices.slice(0, 3).map((device) => (
              <div className="browser-operation-item" key={device.id}>
                <div>
                  <span>{device.name}</span>
                  <small>last seen {new Date(device.lastSeenAt).toLocaleTimeString()}</small>
                </div>
                <strong className="operation-status is-completed">paired</strong>
              </div>
            ))}
          </div>
        ) : null}
        {pendingApprovals.length > 0 ? (
          <div className="browser-operation-list">
            {pendingApprovals.slice(0, 5).map((approval) => (
              <div className="browser-operation-item" key={approval.id}>
                <div>
                  <span>{approval.description || approval.action}</span>
                  <small>{approval.title || approval.url || approval.id}</small>
                </div>
                <strong className="operation-status is-pending_approval">pending</strong>
              </div>
            ))}
          </div>
        ) : null}
        {recentOperations.length > 0 ? (
          <div className="browser-operation-list">
            {recentOperations.slice(0, 5).map((operation) => (
              <div className="browser-operation-item" key={operation.id}>
                <div>
                  <span>{operation.action}</span>
                  <small>{operation.title || operation.url || operation.error || operation.id}</small>
                </div>
                <strong className={`operation-status is-${operation.status}`}>{operation.status}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {localBrowserScreenshot?.dataUrl ? (
          <div className="browser-preview">
            <Image
              src={localBrowserScreenshot.dataUrl}
              alt="本地浏览器截图预览"
              width={localBrowserScreenshot.width ?? 960}
              height={localBrowserScreenshot.height ?? 540}
              unoptimized
            />
            <span>
              {localBrowserScreenshot.width ?? "-"} x {localBrowserScreenshot.height ?? "-"}
            </span>
          </div>
        ) : null}
        <div className="browser-action-grid">
          <label className="settings-field">
            <span>动作</span>
            <select
              value={localBrowserActionDraft.action}
              onChange={(event) =>
                setLocalBrowserActionDraft((current) => ({
                  ...current,
                  action: event.target.value as "navigate" | "click" | "type" | "press"
                }))
              }
            >
              <option value="navigate">navigate</option>
              <option value="click">click</option>
              <option value="type">type</option>
              <option value="press">press</option>
            </select>
          </label>
          {localBrowserActionDraft.action === "navigate" ? (
            <label className="settings-field">
              <span>URL</span>
              <input
                value={localBrowserActionDraft.url}
                onChange={(event) =>
                  setLocalBrowserActionDraft((current) => ({ ...current, url: event.target.value }))
                }
                placeholder="https://example.com"
              />
            </label>
          ) : null}
          {localBrowserActionDraft.action === "click" ? (
            <div className="browser-coordinate-row">
              <label className="settings-field">
                <span>X</span>
                <input
                  value={localBrowserActionDraft.x}
                  onChange={(event) =>
                    setLocalBrowserActionDraft((current) => ({ ...current, x: event.target.value }))
                  }
                  inputMode="numeric"
                  placeholder="320"
                />
              </label>
              <label className="settings-field">
                <span>Y</span>
                <input
                  value={localBrowserActionDraft.y}
                  onChange={(event) =>
                    setLocalBrowserActionDraft((current) => ({ ...current, y: event.target.value }))
                  }
                  inputMode="numeric"
                  placeholder="240"
                />
              </label>
            </div>
          ) : null}
          {localBrowserActionDraft.action === "type" ? (
            <label className="settings-field">
              <span>文本</span>
              <input
                value={localBrowserActionDraft.text}
                onChange={(event) =>
                  setLocalBrowserActionDraft((current) => ({ ...current, text: event.target.value }))
                }
                placeholder="输入文本"
              />
            </label>
          ) : null}
          {localBrowserActionDraft.action === "press" ? (
            <label className="settings-field">
              <span>Key</span>
              <input
                value={localBrowserActionDraft.key}
                onChange={(event) =>
                  setLocalBrowserActionDraft((current) => ({ ...current, key: event.target.value }))
                }
                placeholder="Enter"
              />
            </label>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            disabled={isRunningLocalBrowserAction}
            onClick={() => void runLocalBrowserControlAction()}
          >
            {isRunningLocalBrowserAction ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            执行动作
          </button>
        </div>
        {localBrowserActionResult ? (
          <p className={`muted-note ${localBrowserActionResult.ok ? "" : "error-note"}`}>
            {localBrowserActionResult.ok
              ? `${localBrowserActionResult.action} 已完成：${localBrowserActionResult.title ?? localBrowserActionResult.url ?? "当前页面"}`
              : localBrowserActionResult.error ?? "本地浏览器动作失败。"}
          </p>
        ) : null}
      </div>
    );
  }

  function renderMyComputerPanel() {
    const statusLabel = myComputerStatus
      ? myComputerStatus.connected
        ? "connected"
        : "offline"
      : "unknown";
    const paused = Boolean(myComputerStatus?.paused);
    const readyCapabilities = myComputerStatus?.capabilities.filter((capability) => capability.ready).length ?? 0;
    const pendingCount = myComputerStatus?.pendingApprovals.length ?? 0;
    const rootLabel = myComputerStatus?.allowedRoots[0] ?? "尚未配置";
    const desktopDevices = myComputerPairing?.pairedDevices ?? myComputerStatus?.desktopDevices ?? [];
    const onlineDesktopCount = desktopDevices.filter((device) => device.status === "online").length;
    const latestOperation = myComputerActionResult ?? myComputerPlan?.operation;
    const hasUndoableFileOperation = Boolean(
      myComputerStatus?.recentOperations.some((operation) =>
        ["file_classify", "file_dedupe", "file_rename", "file_move"].includes(operation.kind) &&
        operation.status === "completed"
      )
    );

    return (
      <div className="sandbox-panel">
        <div className="metric-list compact">
          <div className="metric-item">
            <div>
              <span className="metric-name">桌面桥接</span>
              <span className="metric-meta">
                {myComputerStatus?.bridge ?? "next-local"} · {myComputerStatus?.platform ?? "loading"}
              </span>
            </div>
            <strong>{statusLabel}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">桌面客户端</span>
              <span className="metric-meta">
                {onlineDesktopCount ? `${onlineDesktopCount} 台在线` : "等待 Electron/Tauri 客户端配对"}
              </span>
            </div>
            <strong>{desktopDevices.length}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">允许目录</span>
              <span className="metric-meta">{rootLabel}</span>
            </div>
            <strong>{myComputerStatus?.allowedRoots.length ?? 0}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">能力</span>
              <span className="metric-meta">文件操作、应用启动、剪贴板、键鼠授权</span>
            </div>
            <strong>{readyCapabilities}/{myComputerStatus?.capabilities.length ?? 0}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">动作授权</span>
              <span className="metric-meta">
                {paused ? "My Computer 已暂停" : pendingCount ? `${pendingCount} 个操作等待确认` : "每次执行前确认"}
              </span>
            </div>
            <strong>{paused ? "paused" : pendingCount ? "pending" : "active"}</strong>
          </div>
        </div>

        <label className="settings-field">
          <span>允许访问的本机目录</span>
          <textarea
            value={settingsDraft.myComputerAllowedRoots}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                myComputerAllowedRoots: event.target.value
              }))
            }
            placeholder={"/Users/you/Downloads\n/Users/you/Documents/Work"}
          />
        </label>
        <div className="panel-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isCheckingMyComputer}
            onClick={() => void refreshMyComputerStatus()}
          >
            {isCheckingMyComputer ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            检测连接
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isSavingMyComputer}
            onClick={() => void saveMyComputerSettings(myComputerStatus?.paused)}
          >
            {isSavingMyComputer ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
            保存目录
          </button>
          <button
            type="button"
            className={paused ? "secondary-button" : "danger-button"}
            disabled={isSavingMyComputer}
            onClick={() => void saveMyComputerSettings(!paused)}
          >
            {paused ? <Play size={15} /> : <CircleStop size={15} />}
            {paused ? "恢复 My Computer" : "暂停 My Computer"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isUndoingMyComputer || !hasUndoableFileOperation}
            onClick={() => void undoMyComputerLastFileOperation()}
          >
            {isUndoingMyComputer ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            撤销最近
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isSavingMyComputer}
            onClick={() => void clearMyComputerAlwaysAllow()}
          >
            <ShieldCheck size={15} />
            清空授权
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isCreatingMyComputerPairing}
            onClick={() => void createMyComputerDesktopPairing()}
          >
            {isCreatingMyComputerPairing ? <Loader2 size={15} className="spin" /> : <Bot size={15} />}
            桌面端配对
          </button>
        </div>

        {paused ? (
          <p className="muted-note warning-note my-computer-feedback">
            My Computer 当前已暂停。点击“恢复 My Computer”后，扫描、Dry-run 和本机动作才会继续执行。
          </p>
        ) : null}
        {myComputerError ? (
          <p className="muted-note error-note my-computer-feedback">{myComputerError}</p>
        ) : null}
        {myComputerNotice ? (
          <p className="muted-note success-note my-computer-feedback">{myComputerNotice}</p>
        ) : null}

        {myComputerPairing?.activeCode ? (
          <div className="pairing-code-panel">
            <strong>{myComputerPairing.activeCode.code}</strong>
            <span>在 ManusXL Desktop 客户端输入此码，5 分钟内有效。</span>
          </div>
        ) : null}

        {desktopDevices.length ? (
          <div className="browser-operation-list">
            {desktopDevices.slice(0, 5).map((device) => (
              <div className="browser-operation-item" key={device.id}>
                <div>
                  <span>{device.name}</span>
                  <small>
                    {device.bridge} · {device.platform} · v{device.appVersion} · last seen{" "}
                    {new Date(device.lastSeenAt).toLocaleTimeString()}
                  </small>
                </div>
                <strong className={`operation-status is-${device.status === "online" ? "completed" : "blocked"}`}>
                  {device.status}
                </strong>
              </div>
            ))}
          </div>
        ) : null}

        <div className="browser-action-grid">
          <label className="settings-field">
            <span>目标目录</span>
            <input
              value={myComputerDraft.root}
              onChange={(event) =>
                setMyComputerDraft((current) => ({ ...current, root: event.target.value }))
              }
              placeholder={rootLabel}
            />
          </label>
          <label className="settings-field">
            <span>文件任务</span>
            <select
              value={myComputerDraft.mode}
              onChange={(event) =>
                setMyComputerDraft((current) => ({
                  ...current,
                  mode: event.target.value as MyComputerFilePlanMode
                }))
              }
            >
              <option value="classify">按类型分类</option>
              <option value="dedupe">内容查重</option>
              <option value="rename">批量重命名</option>
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={isScanningMyComputer}
            onClick={() => void scanMyComputerRoot()}
          >
            {isScanningMyComputer ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
            扫描
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isPlanningMyComputer}
            onClick={() => void planMyComputerFiles()}
          >
            {isPlanningMyComputer ? <Loader2 size={15} className="spin" /> : <FileArchive size={15} />}
            生成 Dry-run
          </button>
        </div>

        {myComputerScan ? (
          <div className="my-computer-result-block">
            <span className="mini-label">扫描结果</span>
            <div className="browser-operation-list">
              <div className="browser-operation-item">
                <div>
                  <span>扫描完成</span>
                  <small>
                    {myComputerScan.root} · {myComputerScan.total} 项
                    {myComputerScan.truncated ? " · 已截断" : ""}
                  </small>
                </div>
                <strong className="operation-status is-completed">scan</strong>
              </div>
              {myComputerScan.entries.slice(0, 5).map((entry: MyComputerFileEntry) => (
                <div className="browser-operation-item" key={entry.path}>
                  <div>
                    <span>{entry.name}</span>
                    <small>
                      {entry.category ?? entry.kind} · {formatSize(entry.size)}
                    </small>
                  </div>
                  <strong className="operation-status is-started">{entry.kind}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {myComputerPlan ? (
          <div className="my-computer-result-block">
            <span className="mini-label">Dry-run 计划</span>
            <div className="browser-operation-list">
              <div className="browser-operation-item">
                <div>
                  <span>{myComputerPlan.operation.description}</span>
                  <small>
                    {myComputerPlan.summary.actionCount} 个动作 · {myComputerPlan.summary.affectedFiles} 个文件
                  </small>
                </div>
                <strong className={`operation-status is-${myComputerPlan.operation.status}`}>
                  {myComputerPlan.operation.status}
                </strong>
              </div>
              {myComputerPlan.operation.actions?.slice(0, 6).map((action) => (
                <div className="browser-operation-item" key={action.id}>
                  <div>
                    <span>{basenameForUi(action.sourcePath)} → {basenameForUi(action.targetPath)}</span>
                    <small>{action.reason}</small>
                  </div>
                  <strong className="operation-status is-pending_approval">{action.type}</strong>
                </div>
              ))}
            </div>
            {myComputerPlan.operation.status === "pending_approval" ? (
              <div className="panel-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isApprovingMyComputer}
                  onClick={() => void approveMyComputerOperation(myComputerPlan.operation.id, "allow_once")}
                >
                  {isApprovingMyComputer ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                  允许一次
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isApprovingMyComputer}
                  onClick={() => void approveMyComputerOperation(myComputerPlan.operation.id, "always")}
                >
                  Always Allow
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={isApprovingMyComputer}
                  onClick={() => void approveMyComputerOperation(myComputerPlan.operation.id, "deny")}
                >
                  拒绝
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="browser-action-grid">
          <label className="settings-field">
            <span>系统动作</span>
            <select
              value={myComputerDraft.actionKind}
              onChange={(event) =>
                setMyComputerDraft((current) => ({
                  ...current,
                  actionKind: event.target.value as typeof current.actionKind
                }))
              }
            >
              <option value="app_launch">启动应用</option>
              <option value="app_quit">关闭应用</option>
              <option value="clipboard_write">写入剪贴板</option>
              <option value="clipboard_read">读取剪贴板</option>
              <option value="keyboard_shortcut">键盘快捷键</option>
              <option value="mouse_click">鼠标点击</option>
              <option value="terminal_command">本机命令</option>
            </select>
          </label>
          {myComputerDraft.actionKind === "clipboard_write" ? (
            <label className="settings-field">
              <span>剪贴板文本</span>
              <input
                value={myComputerDraft.actionText}
                onChange={(event) =>
                  setMyComputerDraft((current) => ({ ...current, actionText: event.target.value }))
                }
              />
            </label>
          ) : myComputerDraft.actionKind === "clipboard_read" ? (
            <p className="muted-note">读取剪贴板会先进入动作授权，确认后只回传文本长度和预览。</p>
          ) : myComputerDraft.actionKind === "terminal_command" ? (
            <label className="settings-field">
              <span>命令</span>
              <input
                value={myComputerDraft.actionCommand}
                onChange={(event) =>
                  setMyComputerDraft((current) => ({ ...current, actionCommand: event.target.value }))
                }
                placeholder="pwd"
              />
            </label>
          ) : myComputerDraft.actionKind === "mouse_click" ? (
            <div className="browser-coordinate-row">
              <label className="settings-field">
                <span>X</span>
                <input
                  value={myComputerDraft.x}
                  onChange={(event) => setMyComputerDraft((current) => ({ ...current, x: event.target.value }))}
                  inputMode="numeric"
                />
              </label>
              <label className="settings-field">
                <span>Y</span>
                <input
                  value={myComputerDraft.y}
                  onChange={(event) => setMyComputerDraft((current) => ({ ...current, y: event.target.value }))}
                  inputMode="numeric"
                />
              </label>
            </div>
          ) : (
            <label className="settings-field">
              <span>
                {myComputerDraft.actionKind === "app_launch" || myComputerDraft.actionKind === "app_quit"
                  ? "应用名"
                  : "快捷键"}
              </span>
              <input
                value={myComputerDraft.actionTarget}
                onChange={(event) =>
                  setMyComputerDraft((current) => ({ ...current, actionTarget: event.target.value }))
                }
                placeholder={
                  myComputerDraft.actionKind === "app_launch" || myComputerDraft.actionKind === "app_quit"
                    ? "Calculator"
                    : "cmd+c"
                }
              />
            </label>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={isRunningMyComputerAction}
            onClick={() => void runMyComputerSystemAction()}
          >
            {isRunningMyComputerAction ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            生成授权请求
          </button>
        </div>

        {latestOperation ? (
          <div className="browser-operation-list">
            <div className="browser-operation-item">
              <div>
                <span>{latestOperation.description}</span>
                <small>{latestOperation.error ?? latestOperation.target}</small>
              </div>
              <strong className={`operation-status is-${latestOperation.status}`}>{latestOperation.status}</strong>
            </div>
            {latestOperation.status === "pending_approval" && !latestOperation.actions?.length ? (
              <div className="panel-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isApprovingMyComputer}
                  onClick={() => void approveMyComputerOperation(latestOperation.id, "allow_once")}
                >
                  允许一次执行
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isApprovingMyComputer}
                  onClick={() => void approveMyComputerOperation(latestOperation.id, "always")}
                >
                  Always Allow
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={isApprovingMyComputer}
                  onClick={() => void approveMyComputerOperation(latestOperation.id, "deny")}
                >
                  拒绝
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {myComputerStatus?.recentOperations.length ? (
          <div className="browser-operation-list">
            {myComputerStatus.recentOperations.slice(0, 4).map((operation) => (
              <div className="browser-operation-item" key={operation.id}>
                <div>
                  <span>{operation.kind}</span>
                  <small>{operation.description}</small>
                </div>
                <strong className={`operation-status is-${operation.status}`}>{operation.status}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderOcrPanel() {
    const statusLabel = ocrStatus ? (ocrStatus.available ? "ready" : "missing") : "loading";
    const languageLabel = ocrStatus
      ? ocrStatus.languages.length > 0
        ? ocrStatus.languages.slice(0, 6).join(" / ")
        : "no language data"
      : "检查中";
    const missingLabel =
      ocrStatus && ocrStatus.missingLanguages.length > 0
        ? `缺少 ${ocrStatus.missingLanguages.join(" / ")}`
        : "推荐语言已就绪";

    return (
      <div className="sandbox-panel">
        <div className="metric-list compact">
          <div className="metric-item">
            <div>
              <span className="metric-name">引擎</span>
              <span className="metric-meta">{ocrStatus?.version ?? ocrStatus?.reason ?? "检查中"}</span>
            </div>
            <strong>{statusLabel}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">语言包</span>
              <span className="metric-meta">{languageLabel}</span>
            </div>
            <strong>{ocrStatus?.missingLanguages.length ? "todo" : "ok"}</strong>
          </div>
          <div className="metric-item">
            <div>
              <span className="metric-name">建议</span>
              <span className="metric-meta">
                {ocrStatus?.available ? missingLabel : (ocrStatus?.installHint ?? "检查中")}
              </span>
            </div>
            <strong>{ocrStatus?.available ? "识别" : "报告"}</strong>
          </div>
        </div>
        <div className="panel-actions">
          <button type="button" className="secondary-button" onClick={() => void refreshOcrStatus()}>
            <RefreshCw size={15} />
            刷新 OCR
          </button>
        </div>
        <p className={`muted-note ${ocrStatus && !ocrStatus.available ? "error-note" : ""}`}>
          {ocrStatus?.available
            ? "上传图片任务会尝试真实 OCR，并把识别文本写入报告包。"
            : "未安装 OCR 引擎时，任务会生成诊断报告和安装提示，不会中断主流程。"}
        </p>
      </div>
    );
  }

  function renderComposer(variant: "home" | "footer" = "footer") {
    const isHomeComposer = variant === "home";

    return (
      <>
        <form
          className={`composer-form ${isHomeComposer ? "home-composer-form" : ""}`}
          onSubmit={onSubmit}
        >
          <div className="composer-input-stack">
            {uploadedFiles.length > 0 ? (
              <div className="upload-strip" aria-label="已上传文件">
                {uploadedFiles.map((file) => (
                  <span key={file.id} className="upload-chip">
                    <FileText size={14} />
                    <span>
                      <strong>{file.name}</strong>
                      <small>{formatSize(file.size)}</small>
                    </span>
                    <button
                      type="button"
                      className="upload-remove"
                      aria-label={`移除 ${file.name}`}
                      onClick={() =>
                        setUploadedFiles((current) => current.filter((item) => item.id !== file.id))
                      }
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <textarea
              className="prompt-box"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="输入一个任务，例如：读取我上传的 Excel 并输出分析报告"
            />
          </div>
          <div className="composer-actions">
            <button
              type="button"
              className={`secondary-button compact-button execution-target-button ${
                executionTarget === "my-computer" ? "is-active" : ""
              }`}
              disabled={!hasOnlineDesktop || isSubmitting}
              title={
                hasOnlineDesktop
                  ? executionTarget === "my-computer"
                    ? "当前任务将派发到 My Computer 桌面端"
                    : "切换为 My Computer 桌面端执行"
                  : "需要先在 Settings / My Computer 配对并保持桌面端在线"
              }
              onClick={() =>
                setExecutionTarget((current) => (current === "my-computer" ? "cloud" : "my-computer"))
              }
            >
              <Bot size={15} />
              {executionTarget === "my-computer" ? "My Computer" : "云端"}
            </button>
            <input
              ref={fileInputRef}
              className="hidden-file-input"
              type="file"
              multiple
              accept=".txt,.md,.markdown,.json,.csv,.tsv,.html,.htm,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => void uploadFiles(event)}
            />
            <button
              type="button"
              className="icon-button attach-button"
              aria-label="上传文件"
              title="上传文件"
              disabled={isUploadingFile || isSubmitting}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploadingFile ? <Loader2 size={17} className="spin" /> : <Paperclip size={17} />}
            </button>
            <button
              className="primary-button"
              disabled={
                isSubmitting ||
                !selectedOrgCanCreateTask ||
                (!prompt.trim() && uploadedFiles.length === 0)
              }
              title={
                selectedOrgCanCreateTask
                  ? activeOrganization
                    ? `发送到 ${activeOrganization.name}`
                    : "发送到个人私有任务"
                  : "Viewer 角色只能查看组织任务"
              }
            >
              {isSubmitting ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
              发送
            </button>
          </div>
        </form>
        {error ? <p className="muted-note composer-error">{error}</p> : null}
      </>
    );
  }

  function renderMainContent() {
    if (activeNav === "library") return renderLibraryView();
    if (activeNav === "settings") return renderSettingsView();
    if (activeNav === "agent") {
      return activeTask ? (
        <TaskDetail
          task={activeTask}
          isScheduling={isCreatingScheduledTask}
          onSchedule={(task) => void scheduleTaskFromHistory(task)}
        />
      ) : (
        renderAgentEmptyView()
      );
    }
    return (
      <EmptyState onPick={(value) => void submitTask(value)}>
        {renderComposer("home")}
      </EmptyState>
    );
  }

  function renderRightRail() {
    if (activeNav === "settings") {
      return (
        <>
          <section className={panelSectionClass("settings")}>
            <div className="panel-title">运行状态</div>
            <div className="metric-list compact">
              <div className="metric-item">
                <div>
                  <span className="metric-name">模型</span>
                  <span className="metric-meta">{config?.model ?? "deepseek-v4-flash"}</span>
                </div>
                <strong>{config?.hasApiKey ? "ready" : "local"}</strong>
              </div>
              <div className="metric-item">
                <div>
                  <span className="metric-name">沙盒</span>
                  <span className="metric-meta">
                    {sandboxStatus?.mode ?? "unknown"} · {sandboxStatus?.image ?? "not checked"}
                  </span>
                </div>
                <strong>
                  {sandboxStatus?.mode === "local"
                    ? "local"
                    : sandboxStatus?.dockerAvailable && sandboxStatus?.imageAvailable
                      ? "ready"
                      : "check"}
                </strong>
              </div>
              <div className="metric-item">
                <div>
                  <span className="metric-name">存储</span>
                  <span className="metric-meta">SQLite</span>
                </div>
                <strong>on</strong>
              </div>
              <div className="metric-item">
                <div>
                  <span className="metric-name">事件流</span>
                  <span className="metric-meta">SSE</span>
                </div>
                <strong>on</strong>
              </div>
            </div>
          </section>
        </>
      );
    }

    if (activeNav === "library") {
      return (
        <>
          <section className={panelSectionClass("library")}>
            <div className="panel-title">
              <FileSpreadsheet size={14} />
              Billing
            </div>
            <BillingPanel summary={billingSummary} />
          </section>
          <section className={panelSectionClass("agent")}>
            <div className="panel-title">当前任务交付物</div>
            <ArtifactList artifacts={activeTask?.artifacts ?? []} />
          </section>
        </>
      );
    }

    return (
      <>
        <section className={panelSectionClass("agent")}>
          <div className="panel-title">交付物</div>
          <ArtifactList artifacts={activeTask?.artifacts ?? []} />
        </section>

        <section className={panelSectionClass("agent")}>
          <div className="panel-title">
            <Gauge size={14} />
            Context
          </div>
          <ContextMetricsPanel summary={contextMetrics} />
        </section>

        {activeNav === "workspace" ? (
          <section className={panelSectionClass("library")}>
            <div className="panel-title">Library</div>
            <div className="library-stats">
              <div className="stat-box">
                <div className="stat-value">{tasks.length}</div>
                <div className="stat-label">总任务</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{completedTaskCount}</div>
                <div className="stat-label">已完成</div>
              </div>
            </div>
          </section>
        ) : null}
      </>
    );
  }

  if (isAuthLoading) {
    return (
      <div className="auth-shell">
        <div className="auth-panel">
          <Loader2 size={20} className="spin" />
          <p className="muted-note">正在检查登录状态。</p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <AuthScreen
        draft={authDraft}
        mode={authMode}
        notice={authNotice}
        error={error}
        isSubmitting={isAuthSubmitting}
        onDraftChange={(patch) => {
          if ("phone" in patch || "email" in patch || "password" in patch) setAuthNotice(null);
          setAuthDraft((current) => ({ ...current, ...patch }));
        }}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthNotice(null);
          setError(null);
          setAuthDraft((current) => ({ ...current, verificationCode: "" }));
        }}
        onSubmit={submitAuth}
      />
    );
  }

  return (
    <div className={`workspace-shell ${isHomeView ? "is-home" : ""}`}>
      <aside className="left-rail">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-title">ManusXL</span>
          <span className="top-spacer" />
          <button className="icon-button" aria-label="搜索">
            <Search size={17} />
          </button>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setActiveTask(null);
            setActiveNav("workspace");
            resetPageScroll();
          }}
        >
          <Plus size={17} />
          新任务
        </button>

        <nav className="rail-section" aria-label="主导航">
          <button
            type="button"
            className={navButtonClass("workspace")}
            aria-current={activeNav === "workspace" ? "page" : undefined}
            onClick={() => navigateTo("workspace")}
          >
            <Home size={16} />
            工作台
          </button>
          <button
            type="button"
            className={navButtonClass("agent")}
            aria-current={activeNav === "agent" ? "page" : undefined}
            onClick={() => navigateTo("agent")}
          >
            <Bot size={16} />
            Agent
          </button>
          <button
            type="button"
            className={navButtonClass("library")}
            aria-current={activeNav === "library" ? "page" : undefined}
            onClick={() => navigateTo("library")}
          >
            <Archive size={16} />
            Library
          </button>
          <button
            type="button"
            className={navButtonClass("settings")}
            aria-current={activeNav === "settings" ? "page" : undefined}
            onClick={() => navigateTo("settings")}
          >
            <Settings size={16} />
            Settings
          </button>
        </nav>

        <div className="rail-section recent-section">
          <div className="section-label">最近任务</div>
          <label className="rail-search">
            <Search size={13} />
            <input
              value={taskQuery}
              onChange={(event) => setTaskQuery(event.target.value)}
              placeholder="搜索任务"
            />
          </label>
          {visibleTasks.length === 0 ? (
            <p className="muted-note">还没有任务。</p>
          ) : (
            visibleTasks.slice(0, 50).map((task) => (
              <button
                key={task.id}
                className={`task-list-button ${activeTask?.id === task.id ? "is-active" : ""}`}
                onClick={() => {
                  setActiveNav("agent");
                  void selectTask(task.id);
                }}
              >
                <span className={`status-dot ${task.status}`} />
                <span>
                  <span className="task-title">{getUserVisiblePrompt(task.prompt)}</span>
                  <span className="task-meta">
                    {statusText[task.status]} · {formatDate(task.createdAt)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="main-column">
        <header className={`top-bar ${isHomeView ? "home-top-bar" : ""}`}>
          {!isHomeView ? (
            <>
              <span className="model-chip">
                <Sparkles size={15} />
                {config?.model ?? "deepseek-v4-flash"}
              </span>
              <span className="status-chip">
                {config?.hasApiKey ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                {config?.hasApiKey ? "API Key 已配置" : "使用本地回退"}
              </span>
              {contextMetrics && contextMetrics.totalCalls > 0 ? (
                <span className="status-chip">
                  <Gauge size={14} />
                  Context {formatPercent(contextMetrics.averageCacheHitRate)}
                </span>
              ) : null}
              {contextMetrics && contextMetrics.totalCalls > 0 ? (
                <span className="status-chip">
                  <FileSpreadsheet size={14} />
                  Cost {formatUsd(contextMetrics.estimatedCostUsd)}
                </span>
              ) : null}
            </>
          ) : null}
          <span className="status-chip">
            <Bot size={14} />
            {authUser.displayName}
          </span>
          <label className="org-context">
            <ShieldCheck size={14} />
            <select
              aria-label="组织空间"
              value={activeOrgId}
              onChange={(event) => setActiveOrgId(event.target.value)}
            >
              <option value="">个人私有</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          {!isHomeView ? <span className="top-spacer" /> : null}
          {activeTask && (activeTask.status === "running" || activeTask.status === "queued") ? (
            <button className="secondary-button" onClick={() => void cancelActiveTask()}>
              <CircleStop size={15} />
              停止
            </button>
          ) : (
            <>
              {activeTask ? (
                <button className="ghost-button" onClick={() => void retryActiveTask()} disabled={isSubmitting}>
                  <RefreshCw size={15} />
                  重跑
                </button>
              ) : null}
              <button className="ghost-button" onClick={() => void refreshTasks()}>
                <RefreshCw size={15} />
                刷新
              </button>
              <button className="ghost-button" onClick={() => void logout()}>
                <X size={15} />
                退出
              </button>
            </>
          )}
        </header>

        <section className="workspace-main">
          {renderMainContent()}
        </section>

        {showComposer && !isHomeView ? <footer className="composer">{renderComposer("footer")}</footer> : null}
      </main>

      {!isHomeView ? <aside className="right-rail">{renderRightRail()}</aside> : null}
    </div>
  );
}

function AuthScreen({
  draft,
  mode,
  notice,
  error,
  isSubmitting,
  onDraftChange,
  onModeChange,
  onSubmit
}: {
  draft: {
    phone: string;
    email: string;
    password: string;
    displayName: string;
    verificationCode: string;
  };
  mode: AuthMode;
  notice: string | null;
  error: string | null;
  isSubmitting: boolean;
  onDraftChange: (patch: Partial<typeof draft>) => void;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const hasCode = !!draft.verificationCode.trim();
  const isPhone = mode === "phone";
  const isRegister = mode === "email-register";

  return (
    <div className="auth-shell">
      <form className="auth-panel" onSubmit={onSubmit}>
        <div>
          <div className="empty-kicker">Agent Workspace</div>
          <h1>{isPhone ? "手机号验证登录" : isRegister ? "邮箱注册" : "邮箱登录"}</h1>
          <p className="muted-note">
            {isPhone
              ? "开发阶段直接显示验证码；任务、事件和交付物会按手机号隔离保存。"
              : isRegister
                ? "邮箱注册会生成本地验证码，验证后即可进入工作台。"
                : "使用已验证邮箱和密码登录，适合正式账号体系。"}
          </p>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="登录方式">
          <button type="button" className={mode === "phone" ? "is-active" : ""} onClick={() => onModeChange("phone")}>
            手机号
          </button>
          <button type="button" className={mode === "email-login" ? "is-active" : ""} onClick={() => onModeChange("email-login")}>
            邮箱登录
          </button>
          <button type="button" className={mode === "email-register" ? "is-active" : ""} onClick={() => onModeChange("email-register")}>
            邮箱注册
          </button>
        </div>
        <div className="auth-oauth-row">
          <a href="/api/auth/oauth/google/start">Google</a>
          <a href="/api/auth/oauth/github/start">GitHub</a>
        </div>
        {isPhone ? (
          <>
            <label className="settings-field">
              <span>手机号</span>
              <input
                inputMode="tel"
                value={draft.phone}
                onChange={(event) => onDraftChange({ phone: event.target.value, verificationCode: "" })}
                placeholder="请输入 11 位手机号"
              />
            </label>
            <label className="settings-field">
              <span>验证码</span>
              <input
                inputMode="numeric"
                value={draft.verificationCode}
                onChange={(event) => onDraftChange({ verificationCode: event.target.value })}
                placeholder="点击获取后自动显示"
              />
            </label>
          </>
        ) : (
          <>
            <label className="settings-field">
              <span>邮箱</span>
              <input
                inputMode="email"
                value={draft.email}
                onChange={(event) => onDraftChange({ email: event.target.value, verificationCode: "" })}
                placeholder="name@example.com"
              />
            </label>
            <label className="settings-field">
              <span>密码</span>
              <input
                type="password"
                value={draft.password}
                onChange={(event) => onDraftChange({ password: event.target.value })}
                placeholder="至少 8 位"
              />
            </label>
            {isRegister ? (
              <>
                <label className="settings-field">
                  <span>显示名称</span>
                  <input
                    value={draft.displayName}
                    onChange={(event) => onDraftChange({ displayName: event.target.value })}
                    placeholder="可选"
                  />
                </label>
                <label className="settings-field">
                  <span>邮箱验证码</span>
                  <input
                    inputMode="numeric"
                    value={draft.verificationCode}
                    onChange={(event) => onDraftChange({ verificationCode: event.target.value })}
                    placeholder="注册后自动显示"
                  />
                </label>
              </>
            ) : null}
          </>
        )}
        {notice ? <p className="muted-note auth-notice">{notice}</p> : null}
        {error ? <p className="muted-note error-note">{error}</p> : null}
        <button className="primary-button" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
          {isPhone ? (hasCode ? "验证并登录" : "获取验证码") : isRegister ? (hasCode ? "验证并登录" : "注册并获取验证码") : "邮箱登录"}
        </button>
      </form>
    </div>
  );
}

function EmptyState({
  onPick,
  children
}: {
  onPick: (prompt: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-kicker">ManusXL</div>
      <h1 className="empty-title">我能为你做什么？</h1>
      <p className="empty-copy">
        上传文件或输入目标，ManusXL 会整理执行路径、沉淀结论，并生成可下载交付物。
      </p>
      {children}
      <div className="suggestion-grid">
        {suggestions.map((item) => (
          <button key={item} type="button" className="suggestion-button" onClick={() => onPick(item)}>
            <span>{item}</span>
            <span className="tiny-chip">
              <Play size={12} />
              运行
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskDetail({
  task,
  isScheduling,
  onSchedule
}: {
  task: Task;
  isScheduling: boolean;
  onSchedule: (task: Task) => void;
}) {
  const visiblePrompt = getUserVisiblePrompt(task.prompt);
  const uploadedContext = parsePromptUploadedFiles(task.prompt);
  const usefulEvents = task.events.filter(isUsefulTimelineEvent);
  const artifactCount = task.artifacts.length;
  const finalAnswer = task.finalAnswer?.trim();

  return (
    <div className="task-detail">
      <div className="task-heading">
        <span className={`status-dot ${task.status}`} />
        <div className="task-heading-content">
          <div className="task-heading-main">
            <div className="task-heading-title">
              <h1>{visiblePrompt}</h1>
              <p>
                {task.id} · {statusText[task.status]} · {task.model}
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={isScheduling}
              onClick={() => onSchedule(task)}
            >
              {isScheduling ? <Loader2 size={15} className="spin" /> : <Clock3 size={15} />}
              设为定时任务
            </button>
          </div>

          {uploadedContext.length > 0 ? (
            <section className="task-file-context" aria-label="上传文件上下文">
              <div className="task-file-context-head">
                <span>
                  <Paperclip size={14} />
                  上传文件上下文
                </span>
                <small>{uploadedContext.length} 个文件，正文预览已折叠供 Agent 使用</small>
              </div>
              <div className="task-file-context-grid">
                {uploadedContext.map((file, index) => (
                  <article key={`${file.name}-${index}`} className="task-file-context-item">
                    <div>
                      <strong>{file.name}</strong>
                      {file.meta ? <small>{file.meta}</small> : null}
                    </div>
                    {file.summary ? <p>{file.summary}</p> : null}
                    {file.preview ? <em>{file.preview}</em> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <section className="task-result-shell">
        <div className="task-status-strip">
          <div>
            <span>当前状态</span>
            <strong>{statusText[task.status]}</strong>
            <small>{currentTaskStage(task)}</small>
          </div>
          <div>
            <span>交付文件</span>
            <strong>{artifactCount}</strong>
            <small>{artifactCount > 0 ? "右侧已按用途说明" : "生成后会出现在右侧"}</small>
          </div>
          <div>
            <span>执行摘要</span>
            <strong>{usefulEvents.length}</strong>
            <small>详细过程已折叠</small>
          </div>
        </div>

        {finalAnswer ? (
          <article className="final-answer-card">
            <div className="result-section-head">
              <span>
                <CheckCircle2 size={15} />
                最终结果
              </span>
              <small>{formatDate(task.updatedAt)}</small>
            </div>
            <div className="final-answer-content">{finalAnswer}</div>
          </article>
        ) : (
          <article className="final-answer-card is-pending">
            <div className="result-section-head">
              <span>
                <Loader2 size={15} className={task.status === "running" || task.status === "queued" ? "spin" : ""} />
                正在处理
              </span>
            </div>
            <p>{currentTaskStage(task)}</p>
          </article>
        )}

        <details className="execution-details">
          <summary>
            <span>查看执行过程</span>
            <small>仅用于排查和追踪，默认不展示给普通使用流程</small>
          </summary>
          <div className="step-timeline">
            {usefulEvents.length === 0 ? (
              <div className="step-row">
                <span className="step-icon">
                  <Loader2 size={16} />
                </span>
                <div className="step-body">
                  <div className="step-head">
                    <span className="step-title">等待 Agent 启动</span>
                  </div>
                  <div className="step-content">任务已创建，正在进入执行队列。</div>
                </div>
              </div>
            ) : (
              usefulEvents.map((event) => <StepRow key={event.id} event={event} />)
            )}
          </div>
        </details>
      </section>
    </div>
  );
}

function StepRow({ event }: { event: AgentEvent }) {
  const safePayload = event.type === "tool_call" && event.payload ? sanitizePayloadForUi(event.payload) : null;

  return (
    <article className="step-row">
      <span className="step-icon">{getEventIcon(event.type)}</span>
      <div className="step-body">
        <div className="step-head">
          <span className="tiny-chip">{event.type}</span>
          <span className="step-title">{event.title ?? "Agent Step"}</span>
          <span className="step-time">{formatTime(event.createdAt)}</span>
        </div>
        {event.content ? <div className="step-content">{event.content}</div> : null}
        {safePayload ? (
          <pre className="payload-block">{JSON.stringify(safePayload, null, 2)}</pre>
        ) : null}
      </div>
    </article>
  );
}

function ArtifactList({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) {
    return <p className="muted-note">当前任务还没有交付物。</p>;
  }

  const sortedArtifacts = [...artifacts].sort((left, right) => {
    const priority = artifactPriority(left) - artifactPriority(right);
    return priority || left.name.localeCompare(right.name);
  });

  return (
    <div className="artifact-list">
      {sortedArtifacts.map((artifact) => (
        <a key={artifact.id} className="artifact-item" href={artifact.url}>
          <span className="artifact-icon">{getArtifactIcon(artifact.type)}</span>
          <span>
            <span className="artifact-name">{artifact.name}</span>
            <span className="artifact-purpose">{artifactPurpose(artifact)}</span>
            <span className="artifact-meta">
              {artifact.type.toUpperCase()} · {formatSize(artifact.size)}
            </span>
          </span>
          <Download size={16} />
        </a>
      ))}
    </div>
  );
}

function TemplateList({
  templates,
  allTags,
  activeTag,
  onTagChange,
  canSave,
  onSave,
  onUse,
  onPublish,
  onDelete
}: {
  templates: TaskTemplate[];
  allTags: string[];
  activeTag: string;
  onTagChange: (tag: string) => void;
  canSave: boolean;
  onSave: () => void;
  onUse: (template: TaskTemplate) => void;
  onPublish: (templateId: string) => void;
  onDelete: (templateId: string) => void;
}) {
  return (
    <div className="template-panel">
      <button className="secondary-button settings-save" disabled={!canSave} onClick={onSave}>
        <BookmarkPlus size={15} />
        保存当前任务
      </button>
      {allTags.length > 0 && (
        <div className="template-tags" aria-label="模板标签筛选">
          <button
            className={activeTag === "all" ? "template-tag active" : "template-tag"}
            onClick={() => onTagChange("all")}
          >
            全部
          </button>
          {allTags.slice(0, 10).map((tag) => (
            <button
              key={tag}
              className={activeTag === tag ? "template-tag active" : "template-tag"}
              onClick={() => onTagChange(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      {templates.length === 0 ? (
        <p className="muted-note">还没有模板。</p>
      ) : (
        <div className="template-list">
          {templates.slice(0, 8).map((template) => (
            <div key={template.id} className="template-item">
              <button className="template-main" onClick={() => onUse(template)}>
                <span className="template-name">{template.name}</span>
                <span className="template-meta">
                  {[
                    template.isPublic ? "公共" : "个人",
                    template.tags.length > 0 ? template.tags.join(" · ") : "prompt template"
                  ].join(" · ")}
                </span>
              </button>
              {template.isPublic ? (
                <span className="template-lock" aria-label="公共模板不可删除">
                  公
                </span>
              ) : (
                <>
                  <button
                    className="icon-button"
                    aria-label={`发布模板 ${template.name}`}
                    title={template.reviewStatus === "rejected" ? template.rejectionReason : "发布到模板市场"}
                    onClick={() => onPublish(template.id)}
                  >
                    <Sparkles size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`删除模板 ${template.name}`}
                    onClick={() => onDelete(template.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketplaceTemplateList({
  templates,
  sort,
  isForking,
  onSortChange,
  onUse,
  onFork,
  onRate
}: {
  templates: TaskTemplate[];
  sort: MarketplaceSort;
  isForking: boolean;
  onSortChange: (sort: MarketplaceSort) => void;
  onUse: (template: TaskTemplate) => void;
  onFork: (templateId: string) => void;
  onRate: (templateId: string, rating: number) => void;
}) {
  const sortOptions: Array<{ value: MarketplaceSort; label: string }> = [
    { value: "featured", label: "精选" },
    { value: "popular", label: "热门" },
    { value: "topRated", label: "高分" },
    { value: "latest", label: "最新" }
  ];

  return (
    <div className="marketplace-panel">
      <div className="template-tags" aria-label="模板市场排序">
        {sortOptions.map((option) => (
          <button
            key={option.value}
            className={sort === option.value ? "template-tag active" : "template-tag"}
            onClick={() => onSortChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {templates.length === 0 ? (
        <p className="muted-note">模板市场还没有可用模板。</p>
      ) : (
        <div className="marketplace-grid">
          {templates.slice(0, 10).map((template) => (
            <article key={template.id} className="marketplace-item">
              <button className="marketplace-main" onClick={() => onUse(template)}>
                <span className="template-name">{template.name}</span>
                <span className="template-meta">
                  {[
                    template.category ?? "general",
                    `评分 ${(template.ratingAverage ?? 0).toFixed(1)}(${template.ratingCount ?? 0})`,
                    `Fork ${template.forkCount ?? 0}`
                  ].join(" · ")}
                </span>
                <span className="marketplace-description">{template.description}</span>
              </button>
              <div className="marketplace-actions">
                <button
                  type="button"
                  className="secondary-button compact-button"
                  disabled={isForking}
                  onClick={() => onFork(template.id)}
                >
                  <Plus size={13} />
                  Fork
                </button>
                <div className="rating-control" aria-label={`给模板 ${template.name} 评分`}>
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      className="rating-button"
                      onClick={() => onRate(template.id, rating)}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateVariablePanel({
  run,
  onChange,
  onSubmit,
  onCancel
}: {
  run: {
    template: TaskTemplate;
    variables: string[];
    values: Record<string, string>;
  } | null;
  onChange: (name: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (!run) return null;
  const canSubmit = run.variables.every((variable) => run.values[variable]?.trim());

  return (
    <div className="template-variable-panel">
      <div className="template-variable-head">
        <strong>{run.template.name}</strong>
        <button className="icon-button" aria-label="关闭模板变量表单" onClick={onCancel}>
          <X size={13} />
        </button>
      </div>
      {run.variables.map((variable) => (
        <label key={variable} className="settings-field">
          <span>{variable}</span>
          <input
            value={run.values[variable] ?? ""}
            onChange={(event) => onChange(variable, event.target.value)}
            placeholder={`填写 ${variable}`}
          />
        </label>
      ))}
      <button className="secondary-button settings-save" disabled={!canSubmit} onClick={onSubmit}>
        <Play size={15} />
        运行模板
      </button>
    </div>
  );
}

function SkillList({
  skills,
  isUploading,
  onUpload,
  onToggle
}: {
  skills: AgentSkill[];
  isUploading: boolean;
  onUpload: () => void;
  onToggle: (skillId: string, enabled: boolean) => void;
}) {
  return (
    <div className="skill-panel">
      <button className="secondary-button settings-save" disabled={isUploading} onClick={onUpload}>
        <Paperclip size={15} />
        {isUploading ? "上传中" : "上传 Skill ZIP"}
      </button>
      {skills.length === 0 ? (
        <p className="muted-note">还没有可用 Skills。</p>
      ) : (
        <div className="skill-list">
          {skills.slice(0, 8).map((skill) => {
            const blocked = skill.validationStatus === "blocked";
            return (
              <label key={skill.id} className={`skill-item ${blocked ? "is-blocked" : ""}`}>
                <span className="skill-main">
                  <span className="skill-name">{skill.name}</span>
                  <span className="skill-meta">
                    {skill.source} ·{" "}
                    {blocked
                      ? skill.validationWarnings?.[0] ?? "权限校验未通过"
                      : skill.triggers.length > 0
                        ? skill.triggers.slice(0, 3).join(" / ")
                        : "manual"}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={skill.enabled && !blocked}
                  disabled={blocked}
                  onChange={(event) => onToggle(skill.id, event.target.checked)}
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function McpServerPanel({
  servers,
  catalog,
  draft,
  error,
  isAdding,
  onDraftChange,
  onApplyCatalog,
  onAdd,
  onToggle,
  onDelete,
  onRefresh,
  onToolToggle
}: {
  servers: McpServer[];
  catalog: McpCatalogItem[];
  draft: {
    name: string;
    type: "sse" | "stdio";
    url: string;
    command: string;
    args: string;
    env: string;
  };
  error: string | null;
  isAdding: boolean;
  onDraftChange: (patch: Partial<typeof draft>) => void;
  onApplyCatalog: (item: McpCatalogItem) => void;
  onAdd: () => void;
  onToggle: (serverId: string, enabled: boolean) => void;
  onDelete: (serverId: string) => void;
  onRefresh: (serverId: string) => void;
  onToolToggle: (serverId: string, toolName: string, enabled: boolean) => void;
}) {
  const canAdd = draft.name.trim() && (draft.type === "sse" ? draft.url.trim() : draft.command.trim());

  return (
    <div className="mcp-panel">
      {catalog.length > 0 ? (
        <div className="mcp-market">
          {catalog.slice(0, 6).map((item) => (
            <button key={item.id} type="button" className="mcp-market-item" onClick={() => onApplyCatalog(item)}>
              <span className="skill-name">{item.name}</span>
              <span className="skill-meta">
                {item.tags.slice(0, 2).join(" / ")} · {item.type}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="mcp-form">
        <label className="settings-field">
          <span>名称</span>
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ name: event.target.value })}
            placeholder="filesystem"
          />
        </label>
        <label className="settings-field">
          <span>类型</span>
          <select
            value={draft.type}
            onChange={(event) => onDraftChange({ type: event.target.value as "sse" | "stdio" })}
          >
            <option value="stdio">stdio</option>
            <option value="sse">SSE</option>
          </select>
        </label>
        {draft.type === "sse" ? (
          <label className="settings-field">
            <span>URL</span>
            <input
              value={draft.url}
              onChange={(event) => onDraftChange({ url: event.target.value })}
              placeholder="https://example.com/sse"
            />
          </label>
        ) : (
          <>
            <label className="settings-field">
              <span>Command</span>
              <input
                value={draft.command}
                onChange={(event) => onDraftChange({ command: event.target.value })}
                placeholder="npx"
              />
            </label>
            <label className="settings-field">
              <span>Args</span>
              <input
                value={draft.args}
                onChange={(event) => onDraftChange({ args: event.target.value })}
                placeholder="-y @modelcontextprotocol/server-filesystem ./"
              />
            </label>
          </>
        )}
        <label className="settings-field">
          <span>Env</span>
          <textarea
            value={draft.env}
            onChange={(event) => onDraftChange({ env: event.target.value })}
            placeholder="TOKEN=..."
          />
        </label>
        <button className="secondary-button settings-save" disabled={!canAdd || isAdding} onClick={onAdd}>
          <Plus size={15} />
          {isAdding ? "检查中" : "添加 MCP"}
        </button>
        {error ? <p className="muted-note error-note">{error}</p> : null}
      </div>

      {servers.length === 0 ? (
        <p className="muted-note">还没有接入 MCP Server。</p>
      ) : (
        <div className="mcp-list">
          {servers.slice(0, 8).map((server) => (
            <div key={server.id} className={`mcp-item ${server.status}`}>
              <div className="mcp-main">
                <span className="skill-name">{server.name}</span>
                <span className="skill-meta">
                  {server.type} · {server.statusMessage} · {server.tools.slice(0, 3).join(" / ")}
                </span>
                {server.tools.length > 0 ? (
                  <div className="mcp-tool-list">
                    {server.tools.slice(0, 6).map((tool) => {
                      const enabled = !(server.disabledTools ?? []).includes(tool);
                      return (
                        <label key={tool} className="mcp-tool-toggle">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) => onToolToggle(server.id, tool, event.target.checked)}
                          />
                          <span>{tool}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <input
                type="checkbox"
                checked={server.enabled}
                onChange={(event) => onToggle(server.id, event.target.checked)}
              />
              <button className="icon-button" aria-label={`刷新 MCP ${server.name} 工具`} onClick={() => onRefresh(server.id)}>
                <RefreshCw size={14} />
              </button>
              <button className="icon-button" aria-label={`删除 MCP ${server.name}`} onClick={() => onDelete(server.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BillingPanel({ summary }: { summary: BillingSummary | null }) {
  if (!summary || summary.totalCalls === 0) {
    return <p className="muted-note">本月还没有可汇总的模型成本。</p>;
  }

  return (
    <div className="billing-panel">
      <div className="library-stats">
        <div className="stat-box">
          <div className="stat-value">{formatUsd(summary.estimatedCostUsd)}</div>
          <div className="stat-label">{summary.month} · {formatCny(summary.estimatedCostCny)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{formatNumber(summary.totalTokens)}</div>
          <div className="stat-label">tokens</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{summary.totalCalls}</div>
          <div className="stat-label">调用</div>
        </div>
      </div>
      <div className="metric-list">
        {summary.byTask.slice(0, 5).map((task) => (
          <div key={task.taskId} className="metric-item">
            <div>
              <span className="metric-name">{getUserVisiblePrompt(task.prompt).slice(0, 34)}</span>
              <span className="metric-meta">
                {task.model} · {task.totalCalls} calls · {formatNumber(task.totalTokens)} tokens
              </span>
            </div>
            <strong>{formatUsd(task.estimatedCostUsd)}</strong>
          </div>
        ))}
      </div>
      <div className="metric-list compact">
        {summary.byModel.slice(0, 3).map((model) => (
          <div key={model.name} className="metric-item">
            <div>
              <span className="metric-name">{model.name}</span>
              <span className="metric-meta">{formatNumber(model.totalTokens)} tokens</span>
            </div>
            <strong>{formatUsd(model.estimatedCostUsd)}</strong>
          </div>
        ))}
      </div>
      <div className="metric-list compact">
        {summary.byDay.slice(-7).map((day) => (
          <div key={day.name} className="metric-item">
            <div>
              <span className="metric-name">{day.name}</span>
              <span className="metric-meta">
                {day.totalCalls} calls · {formatNumber(day.totalTokens)} tokens
              </span>
            </div>
            <strong>{formatUsd(day.estimatedCostUsd)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContextMetricsPanel({ summary }: { summary: ContextMetricsSummary | null }) {
  if (!summary || summary.totalCalls === 0) {
    return <p className="muted-note">还没有 LLM 上下文指标，提交任务后会自动记录。</p>;
  }

  return (
    <div className="context-panel">
      <div className="library-stats">
        <div className="stat-box">
          <div className="stat-value">{formatPercent(summary.averageCacheHitRate)}</div>
          <div className="stat-label">缓存友好度</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{summary.totalCalls}</div>
          <div className="stat-label">LLM 调用</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{formatNumber(summary.promptTokens)}</div>
          <div className="stat-label">输入 tokens</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{summary.stablePrefixHits}</div>
          <div className="stat-label">前缀复用</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{formatUsd(summary.estimatedCostUsd)}</div>
          <div className="stat-label">预估成本</div>
        </div>
      </div>

      <div className="metric-list">
        {summary.metrics.slice(0, 6).map((metric) => (
          <div key={metric.id} className="metric-item">
            <div>
              <span className="metric-name">{metric.stage}</span>
              <span className="metric-meta">
                {metric.stablePrefixReused ? "prefix reused" : "prefix created"} ·{" "}
                {metric.latencyMs} ms · {formatUsd(metric.estimatedCostUsd)}
              </span>
            </div>
            <strong>{formatPercent(metric.cacheHitRate)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
