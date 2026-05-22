"use client";

import Image from "next/image";
import {
  Archive,
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
  Sparkles,
  SquareTerminal,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentEvent,
  AgentSkill,
  AnalyzeFileResponse,
  Artifact,
  AuthResponse,
  AuthStatus,
  AuthUser,
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
  Task,
  TaskTemplate,
  TaskStatus,
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

type NavigationView = "workspace" | "agent" | "library" | "settings";
type AuthMode = "phone" | "email-login" | "email-register";

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

function createOptimisticTask(taskId: string, prompt: string, model: string, status: TaskStatus): Task {
  const now = new Date().toISOString();
  return {
    id: taskId,
    prompt,
    model,
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

export function AgentWorkspace() {
  const [prompt, setPrompt] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpCatalog, setMcpCatalog] = useState<McpCatalogItem[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
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
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeNav, setActiveNav] = useState<NavigationView>("workspace");
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [contextMetrics, setContextMetrics] = useState<ContextMetricsSummary | null>(null);
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
  const [ocrStatus, setOcrStatus] = useState<OcrStatus | null>(null);
  const [templateRun, setTemplateRun] = useState<{
    template: TaskTemplate;
    variables: string[];
    values: Record<string, string>;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskQuery, setTaskQuery] = useState("");
  const [templateTagFilter, setTemplateTagFilter] = useState("all");
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
    localBrowserDomainAllowlist: ""
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isUploadingSkill, setIsUploadingSkill] = useState(false);
  const [isRunningSandboxTest, setIsRunningSandboxTest] = useState(false);
  const [isCheckingDatabase, setIsCheckingDatabase] = useState(false);
  const [isCheckingLocalBrowser, setIsCheckingLocalBrowser] = useState(false);
  const [isCapturingLocalBrowser, setIsCapturingLocalBrowser] = useState(false);
  const [isRunningLocalBrowserAction, setIsRunningLocalBrowserAction] = useState(false);
  const [isSavingLocalBrowserAllowlist, setIsSavingLocalBrowserAllowlist] = useState(false);
  const [isTogglingLocalBrowserPause, setIsTogglingLocalBrowserPause] = useState(false);
  const [isCreatingLocalBrowserPairing, setIsCreatingLocalBrowserPairing] = useState(false);
  const [localBrowserEndpoint, setLocalBrowserEndpoint] = useState("http://127.0.0.1:9222");
  const [localBrowserActionDraft, setLocalBrowserActionDraft] = useState({
    action: "navigate" as "navigate" | "click" | "type" | "press",
    url: "",
    x: "",
    y: "",
    text: "",
    key: "Enter"
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
  const showComposer = activeNav === "workspace" || activeNav === "agent";

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
          return data.tasks.find((task) => task.id === current.id) ?? current;
        }
        return data.tasks[0] ?? null;
      });
    } catch (caught) {
      setError(getErrorMessage(caught, "刷新任务失败"));
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
        }
      });

      source.onerror = () => {
        source.close();
        eventSourceRef.current = null;
      };
    },
    [closeStream, refreshTasks]
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
        void refreshAuthStatus();
        void refreshTemplates();
        void refreshSkills();
        void refreshMcpServers();
        void refreshMcpCatalog();
        void refreshBilling();
        void refreshSandboxStatus();
        void refreshDatabaseStatus();
        void refreshLocalBrowserStatus();
        void refreshLocalBrowserSafety();
        void refreshLocalBrowserPairing();
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
            localBrowserDomainAllowlist: data.localBrowserDomainAllowlist.join("\n")
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
    refreshAuthStatus,
    refreshAuthUser,
    refreshBilling,
    refreshDatabaseStatus,
    refreshLocalBrowserSafety,
    refreshLocalBrowserPairing,
    refreshLocalBrowserStatus,
    refreshMcpCatalog,
    refreshMcpServers,
    refreshOcrStatus,
    refreshSandboxStatus,
    resumePendingTasks,
    refreshSkills,
    refreshTasks,
    refreshTemplates
  ]);

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
        await refreshSkills();
        await refreshMcpServers();
        await refreshBilling();
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
          fileIds: uploadedFiles.map((file) => file.id)
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
    } catch (caught) {
      setError(getErrorMessage(caught, "文件上传失败"));
    } finally {
      setIsUploadingFile(false);
    }
  }

  async function selectTask(taskId: string) {
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
          localBrowserDomainAllowlist: parseDomainAllowlist(settingsDraft.localBrowserDomainAllowlist)
        })
      });
      const data = await readJson<ConfigResponse>(response);
      setConfig(data);
      setSettingsDraft((current) => ({
        ...current,
        apiKey: "",
        localBrowserDomainAllowlist: data.localBrowserDomainAllowlist.join("\n")
      }));
    } finally {
      setIsSavingSettings(false);
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
        name: activeTask.prompt.slice(0, 36),
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
              <strong>{task.prompt}</strong>
              <small>
                {statusText[task.status]} · {task.model} · {formatDate(task.createdAt)}
              </small>
            </span>
          </button>
        ))}
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

        <div className="view-grid two-columns">
          <section className="section-panel">
            <div className="panel-title">历史任务</div>
            {renderTaskLibrary(16)}
          </section>
          <section className="section-panel">
            <div className="panel-title">
              <BookmarkPlus size={14} />
              模板
            </div>
            {renderTemplatePanel()}
          </section>
        </div>

        <section className="section-panel">
          <div className="panel-title">
            <FileSpreadsheet size={14} />
            Billing
          </div>
          <BillingPanel summary={billingSummary} />
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
              <CheckCircle2 size={14} />
              认证
            </div>
            {renderAuthPanel()}
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

  function renderMainContent() {
    if (activeNav === "library") return renderLibraryView();
    if (activeNav === "settings") return renderSettingsView();
    if (activeNav === "agent") return activeTask ? <TaskDetail task={activeTask} /> : renderAgentEmptyView();
    return <EmptyState onPick={(value) => void submitTask(value)} />;
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
    <div className="workspace-shell">
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
                  <span className="task-title">{task.prompt}</span>
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
        <header className="top-bar">
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
          <span className="status-chip">
            <Bot size={14} />
            {authUser.displayName}
          </span>
          <span className="top-spacer" />
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

        {showComposer ? (
          <footer className="composer">
            <form className="composer-form" onSubmit={onSubmit}>
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
                  disabled={isSubmitting || (!prompt.trim() && uploadedFiles.length === 0)}
                >
                  {isSubmitting ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
                  发送
                </button>
              </div>
            </form>
            {error ? <p className="muted-note">{error}</p> : null}
          </footer>
        ) : null}
      </main>

      <aside className="right-rail">
        {renderRightRail()}
      </aside>
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

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="empty-state">
      <div className="empty-kicker">Agent Workspace</div>
      <h1 className="empty-title">把任务交给 ManusXL。</h1>
      <p className="empty-copy">
        输入一个目标，系统会拆解计划、流式展示执行步骤，并把结果沉淀到右侧交付物区域。
      </p>
      <div className="suggestion-grid">
        {suggestions.map((item) => (
          <button key={item} className="suggestion-button" onClick={() => onPick(item)}>
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

function TaskDetail({ task }: { task: Task }) {
  return (
    <div className="task-detail">
      <div className="task-heading">
        <span className={`status-dot ${task.status}`} />
        <div>
          <h1>{task.prompt}</h1>
          <p>
            {task.id} · {statusText[task.status]} · {task.model}
          </p>
        </div>
      </div>

      <div className="step-timeline">
        {task.events.length === 0 ? (
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
          task.events.map((event) => <StepRow key={event.id} event={event} />)
        )}
      </div>
    </div>
  );
}

function StepRow({ event }: { event: AgentEvent }) {
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
        {event.type === "tool_call" && event.payload ? (
          <pre className="payload-block">{JSON.stringify(event.payload, null, 2)}</pre>
        ) : null}
      </div>
    </article>
  );
}

function ArtifactList({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) {
    return <p className="muted-note">当前任务还没有交付物。</p>;
  }

  return (
    <div className="artifact-list">
      {artifacts.map((artifact) => (
        <a key={artifact.id} className="artifact-item" href={artifact.url}>
          <span className="artifact-icon">{getArtifactIcon(artifact.type)}</span>
          <span>
            <span className="artifact-name">{artifact.name}</span>
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
  onDelete
}: {
  templates: TaskTemplate[];
  allTags: string[];
  activeTag: string;
  onTagChange: (tag: string) => void;
  canSave: boolean;
  onSave: () => void;
  onUse: (template: TaskTemplate) => void;
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
                <button
                  className="icon-button"
                  aria-label={`删除模板 ${template.name}`}
                  onClick={() => onDelete(template.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
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
              <span className="metric-name">{task.prompt.slice(0, 34)}</span>
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
