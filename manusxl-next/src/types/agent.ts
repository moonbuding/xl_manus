export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export type AgentEventType =
  | "thinking"
  | "plan"
  | "tool_call"
  | "tool_result"
  | "message"
  | "artifact"
  | "finished"
  | "failed";

export type ArtifactType =
  | "csv"
  | "docx"
  | "xlsx"
  | "pptx"
  | "pdf"
  | "png"
  | "html"
  | "zip"
  | "txt"
  | "md"
  | "json";

export interface Artifact {
  id: string;
  taskId: string;
  name: string;
  type: ArtifactType;
  mimeType: string;
  content?: string;
  contentEncoding?: "text" | "base64";
  filePath?: string;
  size: number;
  createdAt: string;
  url: string;
}

export interface AuthUser {
  id: string;
  email: string;
  phone?: string;
  displayName: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken?: string;
  refreshToken?: string;
}

export interface ToolCallPayload {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface AgentEvent {
  id: string;
  taskId: string;
  type: AgentEventType;
  createdAt: string;
  stepIndex: number;
  title?: string;
  content?: string;
  payload?: unknown;
}

export interface Task {
  id: string;
  ownerId?: string;
  prompt: string;
  uploadedFileIds?: string[];
  status: TaskStatus;
  model: string;
  createdAt: string;
  updatedAt: string;
  events: AgentEvent[];
  artifacts: Artifact[];
  error?: string;
  finalAnswer?: string;
}

export interface CreateTaskRequest {
  prompt: string;
  model?: string;
  fileIds?: string[];
}

export interface CreateTaskResponse {
  taskId: string;
  status: TaskStatus;
}

export interface UploadedFileSummary {
  id: string;
  name: string;
  mimeType: string;
  extension: string;
  size: number;
  textPreview: string;
  summary: string;
  metadata: Record<string, string | number | boolean>;
}

export interface AnalyzeFileResponse {
  file: UploadedFileSummary;
}

export interface ContextMetric {
  id: string;
  taskId?: string;
  stage: string;
  provider: string;
  model: string;
  prefixHash: string;
  prefixTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
  estimatedCostUsd: number;
  estimatedCostCny: number;
  stablePrefixReused: boolean;
  fallbackUsed: boolean;
  latencyMs: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ContextMetricsSummary {
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  averageCacheHitRate: number;
  estimatedCostUsd: number;
  estimatedCostCny: number;
  estimatedNoCacheCostUsd: number;
  estimatedNoCacheCostCny: number;
  estimatedCacheSavingsUsd: number;
  estimatedCacheSavingsCny: number;
  estimatedCacheSavingsRate: number;
  stablePrefixHits: number;
  prefixInvalidations: number;
  latest?: ContextMetric;
  metrics: ContextMetric[];
}

export interface BillingTaskSummary {
  taskId: string;
  prompt: string;
  model: string;
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostCny: number;
  createdAt: string;
  updatedAt: string;
}

export interface BillingGroupSummary {
  name: string;
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostCny: number;
}

export interface BillingSummary {
  month: string;
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostCny: number;
  byTask: BillingTaskSummary[];
  byModel: BillingGroupSummary[];
  byDay: BillingGroupSummary[];
}

export interface ConfigResponse {
  model: string;
  baseUrl: string;
  temperature: number;
  maxSteps: number;
  taskBudgetUsd: number;
  planningModel: string;
  executionModel: string;
  finalModel: string;
  promptCacheEnabled: boolean;
  hasApiKey: boolean;
}

export interface DatabaseTableCount {
  table: string;
  rows: number;
}

export interface DatabaseStatus {
  requestedProvider: "sqlite" | "postgres";
  activeProvider: "sqlite" | "postgres";
  runtimePostgresReady: boolean;
  note: string;
  sqlite: {
    path: string;
    exists: boolean;
    tables: DatabaseTableCount[];
    totalRows: number;
  };
  postgres: {
    configured: boolean;
    databaseUrlMasked?: string;
    cliAvailable: boolean;
    cliSource?: "local" | "docker";
    cliVersion?: string;
    expectedTableCount: number;
    schemaReady?: boolean;
    schemaTableCount?: number;
    error?: string;
  };
  commands: {
    dryRun: string;
    emitSql: string;
    migrate: string;
  };
}

export interface LocalBrowserStatus {
  endpoint: string;
  connected: boolean;
  checkedAt: string;
  browser?: string;
  protocolVersion?: string;
  webSocketDebuggerUrl?: string;
  error?: string;
}

export interface LocalBrowserTab {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

export interface LocalBrowserSnapshot {
  endpoint: string;
  tabId?: string;
  title?: string;
  url?: string;
  text?: string;
  allowed: boolean;
  ok: boolean;
  error?: string;
}

export interface TaskTemplate {
  id: string;
  ownerId?: string;
  isPublic?: boolean;
  name: string;
  description: string;
  promptTemplate: string;
  defaultModel?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateRequest {
  name: string;
  description?: string;
  promptTemplate: string;
  defaultModel?: string;
  tags?: string[];
  isPublic?: boolean;
}

export interface AgentSkill {
  id: string;
  ownerId?: string;
  name: string;
  description: string;
  triggers: string[];
  toolsRequired: string[];
  source: "builtin" | "local";
  enabled: boolean;
  matched?: boolean;
  validationStatus?: "allowed" | "blocked";
  validationWarnings?: string[];
}

export type McpServerType = "sse" | "stdio";
export type McpServerStatus = "unchecked" | "healthy" | "failed" | "blocked";

export interface McpServer {
  id: string;
  ownerId?: string;
  name: string;
  type: McpServerType;
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  status: McpServerStatus;
  statusMessage: string;
  tools: string[];
  disabledTools?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface McpCatalogItem {
  id: string;
  name: string;
  description: string;
  type: McpServerType;
  command?: string;
  args: string[];
  url?: string;
  envTemplate: string[];
  tags: string[];
  safetyNote: string;
}

export interface CreateMcpServerRequest {
  name: string;
  type: McpServerType;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}
