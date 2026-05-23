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

export type NotificationChannel = "email" | "webhook" | "slack";
export type NotificationLogStatus = "sent" | "development" | "skipped" | "failed";

export interface NotificationSettings {
  ownerId: string;
  emailEnabled: boolean;
  webhookEnabled: boolean;
  slackEnabled: boolean;
  webhookUrl?: string;
  slackWebhookUrl?: string;
  notifyOnCompleted: boolean;
  notifyOnFailed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationLog {
  id: string;
  ownerId: string;
  taskId?: string;
  channel: NotificationChannel;
  status: NotificationLogStatus;
  target?: string;
  title: string;
  message: string;
  error?: string;
  createdAt: string;
}

export type ScheduledTaskStatus = "active" | "paused";
export type ScheduledTaskKind = "interval" | "cron";
export type ScheduledTaskTriggerType = "schedule" | "manual" | "mail" | "slack";
export type ScheduledTaskRunStatus = "created" | "skipped" | "failed";

export interface ScheduledTask {
  id: string;
  ownerId: string;
  name: string;
  prompt: string;
  model: string;
  status: ScheduledTaskStatus;
  kind: ScheduledTaskKind;
  intervalMinutes?: number;
  cronExpression?: string;
  timezone: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastTaskId?: string;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRunLog {
  id: string;
  ownerId: string;
  scheduledTaskId?: string;
  taskId?: string;
  triggerType: ScheduledTaskTriggerType;
  status: ScheduledTaskRunStatus;
  source: string;
  message: string;
  createdAt: string;
}

export interface CreateScheduledTaskRequest {
  name?: string;
  prompt: string;
  model?: string;
  status?: ScheduledTaskStatus;
  kind: ScheduledTaskKind;
  intervalMinutes?: number;
  cronExpression?: string;
  timezone?: string;
}

export type MyComputerBridgeType = "next-local" | "electron" | "tauri";

export type MyComputerDesktopDeviceStatus = "online" | "offline";

export interface MyComputerDesktopDevice {
  id: string;
  ownerId: string;
  name: string;
  bridge: Exclude<MyComputerBridgeType, "next-local">;
  platform: NodeJS.Platform | string;
  appVersion: string;
  capabilities: MyComputerOperationKind[];
  status: MyComputerDesktopDeviceStatus;
  createdAt: string;
  lastSeenAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface MyComputerDesktopPairingStatus {
  activeCode?: {
    code: string;
    expiresAt: string;
  };
  pairedDevices: MyComputerDesktopDevice[];
}

export interface MyComputerDesktopPairingVerifyResponse {
  paired: boolean;
  token?: string;
  device?: MyComputerDesktopDevice;
  error?: string;
}

export type MyComputerDesktopFileRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "uploaded"
  | "failed";

export interface MyComputerDesktopFileRequest {
  id: string;
  ownerId: string;
  deviceId?: string;
  requestedPath: string;
  reason: string;
  status: MyComputerDesktopFileRequestStatus;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  uploadedFileId?: string;
  error?: string;
}

export interface MyComputerDesktopHeartbeatResponse {
  ok: boolean;
  device?: MyComputerDesktopDevice;
  paused?: boolean;
  allowedRoots?: string[];
  pendingApprovals?: MyComputerOperation[];
  recentOperations?: MyComputerOperation[];
  assignedTasks?: MyComputerDesktopTaskAssignment[];
  fileRequests?: MyComputerDesktopFileRequest[];
  error?: string;
}

export type TaskExecutionTarget = "cloud" | "my-computer";

export type MyComputerOperationKind =
  | "file_scan"
  | "file_classify"
  | "file_dedupe"
  | "file_rename"
  | "file_move"
  | "file_undo"
  | "app_launch"
  | "app_quit"
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
  desktopDevices: MyComputerDesktopDevice[];
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

export type MyComputerDesktopTaskStatus = "queued" | "assigned" | "completed" | "failed" | "cancelled";

export interface MyComputerDesktopTaskAssignment {
  id: string;
  taskId: string;
  ownerId: string;
  deviceId: string;
  status: MyComputerDesktopTaskStatus;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  assignedAt?: string;
  completedAt?: string;
  error?: string;
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
  executionTarget?: TaskExecutionTarget;
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
  orgId?: string;
  visibility?: TaskVisibility;
  executionTarget?: TaskExecutionTarget;
}

export interface CreateTaskResponse {
  taskId: string;
  status: TaskStatus;
}

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";

export type TaskVisibility = "private" | "team" | "org";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  taskQuota: number;
  taskCount: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  role?: OrganizationRole;
}

export interface OrganizationMembership {
  orgId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: string;
  updatedAt: string;
  user?: Pick<AuthUser, "id" | "email" | "phone" | "displayName">;
}

export interface OrganizationInvitation {
  id: string;
  orgId: string;
  invitedByUserId: string;
  email?: string;
  phone?: string;
  role: Exclude<OrganizationRole, "owner">;
  token: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
}

export interface OrganizationTaskShare {
  orgId: string;
  taskId: string;
  visibility: Exclude<TaskVisibility, "private">;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
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

export interface UploadedLibraryFile extends UploadedFileSummary {
  createdAt: string;
  expiresAt?: string;
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

export type ModelRouterTaskType =
  | "research"
  | "data"
  | "file"
  | "browser"
  | "design"
  | "coding"
  | "general";

export type ModelRouterStage = "planning" | "execution" | "final_answer";

export interface ModelRouterStageRecommendation {
  stage: ModelRouterStage;
  model: string;
  reason: string;
  confidence: number;
  sampleSize: number;
  averageCostUsd: number;
  successRate: number;
  source: "history" | "fallback" | "manual";
}

export interface ModelRouterPolicySnapshot {
  planning: ModelRouterStageRecommendation;
  execution: ModelRouterStageRecommendation;
  finalAnswer: ModelRouterStageRecommendation;
}

export interface ModelRouterTaskTypeRecommendation {
  taskType: ModelRouterTaskType;
  label: string;
  taskCount: number;
  metricCount: number;
  dataSufficient: boolean;
  policy: ModelRouterPolicySnapshot;
}

export interface ModelRouterAbTestSnapshot {
  sampleSize: number;
  baselineCostUsd: number;
  candidateCostUsd: number;
  costSavingsRate: number;
  baselineQualityScore: number;
  candidateQualityScore: number;
  qualityDelta: number;
  winner: "candidate" | "baseline" | "insufficient_data";
  notes: string[];
}

export interface ModelRouterOptimizerResponse {
  generatedAt: string;
  selectedTaskType: ModelRouterTaskType;
  selectedLabel: string;
  latencyMs: number;
  currentPolicy: {
    baseModel: string;
    planningModel: string;
    executionModel: string;
    finalModel: string;
    manualOverride: boolean;
  };
  recommendation: ModelRouterTaskTypeRecommendation;
  byTaskType: ModelRouterTaskTypeRecommendation[];
  abTest: ModelRouterAbTestSnapshot;
  fallbackReason?: string;
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
  designImageProvider: string;
  designImageMaxPerTask: number;
  hasDesignImageApiKey: boolean;
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
  sourceTemplateId?: string;
  category?: string;
  creatorName?: string;
  ratingAverage?: number;
  ratingCount?: number;
  forkCount?: number;
  runCount?: number;
  reviewStatus?: "draft" | "approved" | "rejected";
  rejectionReason?: string;
  marketplaceFeatured?: boolean;
  publishedAt?: string;
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
  category?: string;
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
