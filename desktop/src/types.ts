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

export interface DesktopDeviceConfig {
  serverUrl: string;
  token?: string;
  deviceId?: string;
  deviceName: string;
}

export interface DesktopDevice {
  id: string;
  ownerId: string;
  name: string;
  bridge: "electron" | "tauri";
  platform: string;
  appVersion: string;
  capabilities: MyComputerOperationKind[];
  status: "online" | "offline";
  createdAt: string;
  lastSeenAt: string;
}

export interface PairingVerifyResponse {
  paired: boolean;
  token?: string;
  device?: DesktopDevice;
  error?: string;
}

export interface HeartbeatResponse {
  ok: boolean;
  device?: DesktopDevice;
  paused?: boolean;
  allowedRoots?: string[];
  pendingApprovals?: Array<{
    id: string;
    kind: MyComputerOperationKind;
    status: string;
    description: string;
    target: string;
  }>;
  assignedTasks?: DesktopTaskAssignment[];
  fileRequests?: DesktopFileRequest[];
  error?: string;
}

export type DesktopFileRequestStatus = "pending" | "approved" | "denied" | "uploaded" | "failed";

export interface DesktopFileRequest {
  id: string;
  ownerId: string;
  deviceId?: string;
  requestedPath: string;
  reason: string;
  status: DesktopFileRequestStatus;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  uploadedFileId?: string;
  error?: string;
}

export interface DesktopTaskAssignment {
  id: string;
  taskId: string;
  ownerId: string;
  deviceId: string;
  status: "queued" | "assigned" | "completed" | "failed" | "cancelled";
  prompt: string;
  createdAt: string;
  updatedAt: string;
  assignedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface DesktopTaskClaimResponse {
  ok: boolean;
  assignment?: DesktopTaskAssignment;
  task?: {
    id: string;
    prompt: string;
    model: string;
    uploadedFileIds: string[];
    createdAt: string;
  };
  error?: string;
}

export interface DesktopRuntimeStatus {
  configured: boolean;
  serverUrl: string;
  deviceName: string;
  lastHeartbeat?: HeartbeatResponse;
  currentTask?: DesktopTaskAssignment;
  lastTask?: DesktopTaskAssignment;
  lastUpload?: DesktopCloudUploadResult;
  pendingFileRequests?: DesktopFileRequest[];
  lastFileRequest?: DesktopFileRequest;
  lastError?: string;
}

export interface DesktopCloudUploadResult {
  ok: boolean;
  file?: {
    id: string;
    name: string;
    mimeType: string;
    extension: string;
    size: number;
    summary: string;
    metadata: Record<string, string | number | boolean>;
  };
  expiresAt?: string;
  error?: string;
}
