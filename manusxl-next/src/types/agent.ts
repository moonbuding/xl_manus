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

export type OAuthProvider = "google" | "github";

export interface AuthProviderStatus {
  provider: OAuthProvider;
  configured: boolean;
  callbackUrl: string;
  authorizeUrl: string;
  scope: string;
  missing: string[];
}

export interface AuthStatus {
  baseUrl: string;
  email: {
    mode: "development" | "smtp";
    configured: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    from?: string;
    verificationCodeExposed: boolean;
  };
  oauth: AuthProviderStatus[];
  session: {
    accessCookieName: string;
    refreshCookieName: string;
    accessMaxAgeSeconds: number;
    refreshMaxAgeSeconds: number;
    cookieSecure: boolean;
  };
}

export type AuditLogStatus = "started" | "completed" | "failed" | "blocked";

export interface AuditLog {
  id: string;
  userId?: string;
  taskId?: string;
  stepId?: string;
  action: string;
  resource: string;
  status: AuditLogStatus;
  ip?: string;
  userAgent?: string;
  metadata: Record<string, unknown>;
  metadataHash: string;
  previousHash: string;
  entryHash: string;
  createdAt: string;
}

export interface AuditLogListResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditVerifyResult {
  ok: boolean;
  total: number;
  checkedAt: string;
  firstHash?: string;
  lastHash?: string;
  brokenAt?: string;
  error?: string;
}

export type MyComputerBridgeType = "next-local" | "electron" | "tauri";

export type MyComputerOperationKind =
  | "file_scan"
  | "file_classify"
  | "file_dedupe"
  | "file_rename"
  | "file_move"
  | "file_undo"
  | "app_launch"
  | "clipboard_write"
  | "clipboard_read"
  | "keyboard_shortcut"
  | "mouse_click"
  | "terminal_command";

export type MyComputerOperationStatus =
  | "planned"
  | "pending_approval"
  | "approved"
  | "completed"
  | "undone"
  | "blocked"
  | "failed";

export type MyComputerApprovalDecision = "allow_once" | "always" | "deny";

export type MyComputerFilePlanMode = "classify" | "dedupe" | "rename";

export interface MyComputerFileEntry {
  path: string;
  name: string;
  extension: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: string;
  category?: string;
  hash?: string;
}

export interface MyComputerFileAction {
  id: string;
  type: "move" | "rename";
  sourcePath: string;
  targetPath: string;
  reason: string;
  duplicateGroupId?: string;
}

export interface MyComputerOperation {
  id: string;
  ownerId?: string;
  kind: MyComputerOperationKind;
  status: MyComputerOperationStatus;
  target: string;
  description: string;
  dryRun: boolean;
  requiresApproval: boolean;
  approvalDecision?: MyComputerApprovalDecision;
  actions?: MyComputerFileAction[];
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MyComputerStatus {
  connected: boolean;
  bridge: MyComputerBridgeType;
  platform: NodeJS.Platform | string;
  paused: boolean;
  allowedRoots: string[];
  capabilities: Array<{
    id: MyComputerOperationKind | "desktop_bridge";
    label: string;
    ready: boolean;
    requiresApproval: boolean;
    note: string;
  }>;
  recentOperations: MyComputerOperation[];
  pendingApprovals: MyComputerOperation[];
}

export interface MyComputerFileScanResponse {
  root: string;
  total: number;
  truncated: boolean;
  entries: MyComputerFileEntry[];
}

export interface MyComputerFilePlanResponse {
  operation: MyComputerOperation;
  summary: {
    mode: MyComputerFilePlanMode;
    actionCount: number;
    affectedFiles: number;
  };
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
  localBrowserDomainAllowlist: string[];
  myComputerAllowedRoots: string[];
  myComputerPaused: boolean;
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
  allowlistConfigured?: boolean;
  paused?: boolean;
  recentOperations?: LocalBrowserOperation[];
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

export interface LocalBrowserScreenshot {
  endpoint: string;
  tabId?: string;
  title?: string;
  url?: string;
  mimeType?: "image/jpeg" | "image/png";
  dataUrl?: string;
  width?: number;
  height?: number;
  allowed: boolean;
  ok: boolean;
  error?: string;
}

export type LocalBrowserActionType = "navigate" | "click" | "type" | "press";

export type LocalBrowserOperationStatus =
  | "started"
  | "pending_approval"
  | "approved"
  | "completed"
  | "blocked"
  | "failed";

export interface LocalBrowserOperation {
  id: string;
  ownerId?: string;
  source: "agent" | "settings" | "api";
  action: LocalBrowserActionType | "snapshot" | "screenshot" | "status" | "unknown";
  status: LocalBrowserOperationStatus;
  title?: string;
  url?: string;
  tabId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type LocalBrowserApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface LocalBrowserApprovalRequest {
  id: string;
  operationId: string;
  ownerId?: string;
  source: "agent" | "settings" | "api";
  action: LocalBrowserActionType;
  status: LocalBrowserApprovalStatus;
  title?: string;
  url?: string;
  tabId?: string;
  description?: string;
  requestedAt: string;
  expiresAt: string;
  decidedAt?: string;
}

export interface LocalBrowserSafetyState {
  paused: boolean;
  recentOperations: LocalBrowserOperation[];
  pendingApprovals: LocalBrowserApprovalRequest[];
}

export interface LocalBrowserPairedDevice {
  id: string;
  ownerId: string;
  name: string;
  extensionId?: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface LocalBrowserPairingCode {
  code: string;
  expiresAt: string;
}

export interface LocalBrowserPairingStatus {
  activeCode?: LocalBrowserPairingCode;
  pairedDevices: LocalBrowserPairedDevice[];
}

export interface LocalBrowserPairingVerifyResponse {
  paired: boolean;
  token?: string;
  device?: LocalBrowserPairedDevice;
  safety?: LocalBrowserSafetyState;
  error?: string;
}

export interface LocalBrowserActionResult {
  endpoint: string;
  tabId?: string;
  title?: string;
  url?: string;
  action: LocalBrowserActionType | "unknown";
  allowed: boolean;
  ok: boolean;
  message?: string;
  snapshot?: LocalBrowserSnapshot;
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
