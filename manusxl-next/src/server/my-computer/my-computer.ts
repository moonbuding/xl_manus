import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";
import { promisify } from "node:util";
import { createId } from "@/lib/id";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import {
  getMyComputerAlwaysAllowRules,
  getMyComputerAllowedRoots,
  isMyComputerPaused,
  updateAppConfig
} from "@/server/config/app-config";
import { dataPath } from "@/server/data-root";
import {
  addArtifact,
  addTaskEvent,
  getTask,
  setFinalAnswer,
  updateTaskStatus
} from "@/server/tasks/task-store";
import type {
  MyComputerApprovalDecision,
  MyComputerBridgeType,
  MyComputerDesktopDevice,
  MyComputerDesktopFileRequest,
  MyComputerDesktopHeartbeatResponse,
  MyComputerDesktopPairingStatus,
  MyComputerDesktopPairingVerifyResponse,
  MyComputerDesktopTaskAssignment,
  MyComputerFileAction,
  MyComputerFileEntry,
  MyComputerFilePlanMode,
  MyComputerFilePlanResponse,
  MyComputerFileScanResponse,
  MyComputerOperation,
  MyComputerOperationKind,
  MyComputerStatus,
  AgentEventType
} from "@/types/agent";

const execFileAsync = promisify(execFile);
const maxRecentOperations = 80;
const maxFileHashBytes = 50 * 1024 * 1024;
const terminalTimeoutMs = 5000;
const terminalMaxBuffer = 256 * 1024;
const allowedTerminalCommands = new Set(["pwd", "whoami", "date", "ls", "echo"]);
const desktopPairingTtlMs = 5 * 60 * 1000;
const desktopOnlineWindowMs = 45 * 1000;
const maxDesktopDevices = 12;
const maxDesktopFileRequests = 120;
const undoableFileKinds = new Set<MyComputerOperationKind>([
  "file_classify",
  "file_dedupe",
  "file_rename",
  "file_move"
]);

interface DesktopPairingCodeRecord {
  code: string;
  ownerId: string;
  expiresAt: string;
}

interface DesktopDeviceRecord extends Omit<MyComputerDesktopDevice, "status"> {
  tokenHash: string;
}

interface DesktopTaskAssignmentRecord extends MyComputerDesktopTaskAssignment {
  acknowledgedAt?: string;
}

type DesktopFileUploadRequestRecord = MyComputerDesktopFileRequest;

const categoryByExtension: Record<string, string> = {
  ".jpg": "images",
  ".jpeg": "images",
  ".png": "images",
  ".gif": "images",
  ".webp": "images",
  ".heic": "images",
  ".pdf": "documents",
  ".doc": "documents",
  ".docx": "documents",
  ".txt": "documents",
  ".md": "documents",
  ".csv": "spreadsheets",
  ".xls": "spreadsheets",
  ".xlsx": "spreadsheets",
  ".ppt": "presentations",
  ".pptx": "presentations",
  ".zip": "archives",
  ".rar": "archives",
  ".7z": "archives",
  ".ts": "code",
  ".tsx": "code",
  ".js": "code",
  ".jsx": "code",
  ".py": "code",
  ".json": "code",
  ".mp4": "media",
  ".mov": "media",
  ".mp3": "media",
  ".wav": "media"
};

const dangerousRootPatterns = [
  /^\/$/,
  /^\/System(?:\/|$)/,
  /^\/bin(?:\/|$)/,
  /^\/sbin(?:\/|$)/,
  /^\/usr(?:\/|$)/,
  /^\/private(?:\/|$)/,
  /^\/Applications(?:\/|$)/,
  /^[A-Z]:\\$/i,
  /^[A-Z]:\\Windows(?:\\|$)/i,
  /^[A-Z]:\\Program Files/i
];

const globalForMyComputer = globalThis as unknown as {
  manusxlMyComputerOperations?: MyComputerOperation[];
  manusxlMyComputerAlwaysAllow?: Set<string>;
  manusxlMyComputerDesktopPairingCodes?: DesktopPairingCodeRecord[];
  manusxlMyComputerDesktopDevices?: DesktopDeviceRecord[];
  manusxlMyComputerDesktopTaskAssignments?: DesktopTaskAssignmentRecord[];
  manusxlMyComputerDesktopFileRequests?: DesktopFileUploadRequestRecord[];
};

function operationList() {
  globalForMyComputer.manusxlMyComputerOperations ??= [];
  return globalForMyComputer.manusxlMyComputerOperations;
}

function alwaysAllowSet() {
  globalForMyComputer.manusxlMyComputerAlwaysAllow ??= new Set<string>();
  getMyComputerAlwaysAllowRules().forEach((rule) =>
    globalForMyComputer.manusxlMyComputerAlwaysAllow?.add(rule)
  );
  return globalForMyComputer.manusxlMyComputerAlwaysAllow;
}

function desktopPairingCodes() {
  globalForMyComputer.manusxlMyComputerDesktopPairingCodes ??= [];
  return globalForMyComputer.manusxlMyComputerDesktopPairingCodes;
}

function desktopDeviceRecords() {
  globalForMyComputer.manusxlMyComputerDesktopDevices ??= [];
  return globalForMyComputer.manusxlMyComputerDesktopDevices;
}

function desktopTaskAssignments() {
  globalForMyComputer.manusxlMyComputerDesktopTaskAssignments ??= [];
  return globalForMyComputer.manusxlMyComputerDesktopTaskAssignments;
}

function desktopFileUploadRequests() {
  globalForMyComputer.manusxlMyComputerDesktopFileRequests ??= [];
  return globalForMyComputer.manusxlMyComputerDesktopFileRequests;
}

function persistAlwaysAllowRules() {
  updateAppConfig({
    myComputerAlwaysAllowRules: Array.from(alwaysAllowSet()).slice(0, 100)
  });
}

function nowMs() {
  return Date.now();
}

function makeDesktopPairingCode() {
  const value = String(Math.floor(100000 + Math.random() * 900000));
  return `${value.slice(0, 3)}-${value.slice(3)}`;
}

function normalizePairingCode(code: string) {
  return code.replace(/[^0-9a-z]/gi, "").toUpperCase();
}

function makeDesktopDeviceToken() {
  return `mcd_${randomBytes(24).toString("base64url")}`;
}

function hashDesktopDeviceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cleanExpiredDesktopPairingCodes() {
  const active = desktopPairingCodes().filter((record) => Date.parse(record.expiresAt) > nowMs());
  globalForMyComputer.manusxlMyComputerDesktopPairingCodes = active;
  return active;
}

function desktopDeviceStatus(record: DesktopDeviceRecord) {
  return Date.parse(record.lastSeenAt) > nowMs() - desktopOnlineWindowMs ? "online" : "offline";
}

function publicDesktopDevice(record: DesktopDeviceRecord): MyComputerDesktopDevice {
  return {
    id: record.id,
    ownerId: record.ownerId,
    name: record.name,
    bridge: record.bridge,
    platform: record.platform,
    appVersion: record.appVersion,
    capabilities: record.capabilities,
    status: desktopDeviceStatus(record),
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    metadata: record.metadata
  };
}

function listDesktopDevicesForOwner(ownerId?: string) {
  if (!ownerId) return [];
  return desktopDeviceRecords()
    .filter((record) => record.ownerId === ownerId)
    .map(publicDesktopDevice);
}

function onlineDesktopDevicesForOwner(ownerId: string) {
  return desktopDeviceRecords().filter(
    (record) => record.ownerId === ownerId && desktopDeviceStatus(record) === "online"
  );
}

function publicDesktopAssignment(record: DesktopTaskAssignmentRecord): MyComputerDesktopTaskAssignment {
  return {
    id: record.id,
    taskId: record.taskId,
    ownerId: record.ownerId,
    deviceId: record.deviceId,
    status: record.status,
    prompt: record.prompt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    assignedAt: record.assignedAt,
    completedAt: record.completedAt,
    error: record.error
  };
}

function desktopAssignmentsForOwner(ownerId: string) {
  return desktopTaskAssignments()
    .filter((assignment) => assignment.ownerId === ownerId && ["queued", "assigned"].includes(assignment.status))
    .map(publicDesktopAssignment);
}

function publicDesktopFileUploadRequest(
  record: DesktopFileUploadRequestRecord
): MyComputerDesktopFileRequest {
  return {
    id: record.id,
    ownerId: record.ownerId,
    deviceId: record.deviceId,
    requestedPath: record.requestedPath,
    reason: record.reason,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    decidedAt: record.decidedAt,
    uploadedFileId: record.uploadedFileId,
    error: record.error
  };
}

function desktopFileRequestsForOwner(ownerId: string) {
  return desktopFileUploadRequests()
    .filter((request) => request.ownerId === ownerId)
    .map(publicDesktopFileUploadRequest);
}

function pendingDesktopFileRequestsForDevice(device: DesktopDeviceRecord) {
  return desktopFileUploadRequests()
    .filter(
      (request) =>
        request.ownerId === device.ownerId &&
        request.status === "pending" &&
        (!request.deviceId || request.deviceId === device.id)
    )
    .map(publicDesktopFileUploadRequest);
}

const terminalTaskStatuses = new Set(["completed", "failed", "cancelled", "timeout"]);

export function hasOnlineMyComputerDesktop(ownerId: string) {
  return onlineDesktopDevicesForOwner(ownerId).length > 0;
}

export function listMyComputerDesktopFileRequests(ownerId: string) {
  return desktopFileRequestsForOwner(ownerId);
}

export function requestMyComputerDesktopFileUpload(input: {
  ownerId: string;
  requestedPath?: string;
  reason?: string;
  deviceId?: string;
}) {
  const requestedPath = input.requestedPath?.trim();
  if (!requestedPath) {
    return { ok: false as const, status: 400, error: "需要提供本机文件路径。" };
  }
  const devices = onlineDesktopDevicesForOwner(input.ownerId);
  const device = input.deviceId
    ? devices.find((candidate) => candidate.id === input.deviceId)
    : devices[0];
  if (!device) {
    return { ok: false as const, status: 409, error: "没有在线的 My Computer 桌面端设备" };
  }

  const now = new Date().toISOString();
  const record: DesktopFileUploadRequestRecord = {
    id: createId("mcfile"),
    ownerId: input.ownerId,
    deviceId: device.id,
    requestedPath: requestedPath.slice(0, 1000),
    reason: (input.reason?.trim() || "ManusXL 请求上传这个本机文件以继续任务。").slice(0, 1000),
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
  desktopFileUploadRequests().unshift(record);
  if (desktopFileUploadRequests().length > maxDesktopFileRequests) {
    desktopFileUploadRequests().length = maxDesktopFileRequests;
  }

  safeRecordAuditLog({
    userId: input.ownerId,
    action: "my_computer.desktop_file.request_upload",
    resource: `desktop:${device.id}`,
    status: "started",
    metadata: {
      requestId: record.id,
      deviceName: device.name,
      requestedPath: record.requestedPath,
      reason: record.reason
    }
  });

  return {
    ok: true as const,
    request: publicDesktopFileUploadRequest(record),
    device: publicDesktopDevice(device)
  };
}

export function decideMyComputerDesktopFileUploadRequest(input: {
  token?: string;
  requestId: string;
  decision?: "approve" | "deny";
  uploadedFileId?: string;
  error?: string;
}) {
  const device = resolveMyComputerDesktopDeviceToken(input.token);
  if (!device) return { ok: false as const, status: 401, error: "桌面端未配对或令牌已失效。" };
  const record = desktopFileUploadRequests().find(
    (candidate) =>
      candidate.id === input.requestId &&
      candidate.ownerId === device.ownerId &&
      candidate.status === "pending" &&
      (!candidate.deviceId || candidate.deviceId === device.id)
  );
  if (!record) {
    return { ok: false as const, status: 404, error: "文件上传请求不存在或已处理。" };
  }

  const now = new Date().toISOString();
  record.decidedAt = now;
  record.updatedAt = now;
  if (input.decision === "deny") {
    record.status = "denied";
    record.error = input.error?.trim().slice(0, 1000) || "用户拒绝了本机文件上传请求。";
  } else if (input.uploadedFileId?.trim()) {
    record.status = "uploaded";
    record.uploadedFileId = input.uploadedFileId.trim().slice(0, 120);
    record.error = undefined;
  } else if (input.error?.trim()) {
    record.status = "failed";
    record.error = input.error.trim().slice(0, 1000);
  } else {
    record.status = "approved";
    record.error = undefined;
  }

  safeRecordAuditLog({
    userId: device.ownerId,
    action: "my_computer.desktop_file.request_decide",
    resource: `desktop:${device.id}`,
    status: record.status === "denied" || record.status === "failed" ? "blocked" : "completed",
    metadata: {
      requestId: record.id,
      decision: input.decision ?? "approve",
      status: record.status,
      uploadedFileId: record.uploadedFileId,
      error: record.error
    }
  });

  return { ok: true as const, request: publicDesktopFileUploadRequest(record), device: publicDesktopDevice(device) };
}

export function dispatchTaskToMyComputerDesktop(input: {
  taskId: string;
  ownerId: string;
  deviceId?: string;
}) {
  const task = getTask(input.taskId, input.ownerId);
  if (!task) return { ok: false as const, status: 404, error: "任务不存在" };
  const devices = onlineDesktopDevicesForOwner(input.ownerId);
  const device = input.deviceId
    ? devices.find((candidate) => candidate.id === input.deviceId)
    : devices[0];
  if (!device) {
    return { ok: false as const, status: 409, error: "没有在线的 My Computer 桌面端设备" };
  }

  const now = new Date().toISOString();
  const assignment: DesktopTaskAssignmentRecord = {
    id: createId("mctask"),
    taskId: task.id,
    ownerId: input.ownerId,
    deviceId: device.id,
    status: "queued",
    prompt: task.prompt,
    createdAt: now,
    updatedAt: now
  };
  desktopTaskAssignments().unshift(assignment);
  updateTaskStatus(task.id, "running");
  addTaskEvent(task.id, {
    type: "message",
    stepIndex: task.events.length + 1,
    title: "派发到 My Computer",
    content: `任务已派发到桌面端 ${device.name}，等待客户端接收。`,
    payload: {
      assignmentId: assignment.id,
      deviceId: device.id,
      bridge: device.bridge
    }
  });
  safeRecordAuditLog({
    userId: input.ownerId,
    taskId: task.id,
    action: "my_computer.desktop_task.dispatch",
    resource: `desktop:${device.id}`,
    status: "completed",
    metadata: {
      assignmentId: assignment.id,
      deviceName: device.name,
      bridge: device.bridge
    }
  });
  return { ok: true as const, assignment: publicDesktopAssignment(assignment), device: publicDesktopDevice(device) };
}

export function claimNextMyComputerDesktopTask(token?: string) {
  const device = resolveMyComputerDesktopDeviceToken(token);
  if (!device) return { ok: false as const, status: 401, error: "桌面端未配对或令牌已失效。" };
  const assignment = desktopTaskAssignments().find(
    (candidate) =>
      candidate.ownerId === device.ownerId &&
      candidate.deviceId === device.id &&
      candidate.status === "queued"
  );
  if (!assignment) {
    return { ok: true as const, assignment: undefined, device: publicDesktopDevice(device) };
  }

  const task = getTask(assignment.taskId, assignment.ownerId);
  if (!task) {
    assignment.status = "failed";
    assignment.error = "任务不存在";
    assignment.updatedAt = new Date().toISOString();
    return { ok: true as const, assignment: undefined, device: publicDesktopDevice(device) };
  }
  if (terminalTaskStatuses.has(task.status)) {
    assignment.status = task.status === "cancelled" ? "cancelled" : "failed";
    assignment.error = `任务已进入终态：${task.status}`;
    assignment.completedAt = new Date().toISOString();
    assignment.updatedAt = assignment.completedAt;
    return { ok: true as const, assignment: undefined, device: publicDesktopDevice(device) };
  }

  const now = new Date().toISOString();
  assignment.status = "assigned";
  assignment.assignedAt = now;
  assignment.updatedAt = now;
  addTaskEvent(task.id, {
    type: "message",
    stepIndex: task.events.length + 1,
    title: "桌面端已接收",
    content: `${device.name} 已接收任务，正在本机执行。`,
    payload: {
      assignmentId: assignment.id,
      deviceId: device.id
    }
  });
  return {
    ok: true as const,
    assignment: publicDesktopAssignment(assignment),
    task: {
      id: task.id,
      prompt: task.prompt,
      model: task.model,
      uploadedFileIds: task.uploadedFileIds ?? [],
      createdAt: task.createdAt
    },
    device: publicDesktopDevice(device)
  };
}

export function appendMyComputerDesktopTaskEvent(input: {
  token?: string;
  taskId: string;
  type?: AgentEventType;
  title?: string;
  content?: string;
  payload?: unknown;
}) {
  const device = resolveMyComputerDesktopDeviceToken(input.token);
  if (!device) return { ok: false as const, status: 401, error: "桌面端未配对或令牌已失效。" };
  const assignment = desktopTaskAssignments().find(
    (candidate) =>
      candidate.ownerId === device.ownerId &&
      candidate.deviceId === device.id &&
      candidate.taskId === input.taskId &&
      (candidate.status === "queued" || candidate.status === "assigned")
  );
  if (!assignment) return { ok: false as const, status: 404, error: "桌面端任务不存在或已完成。" };
  const task = getTask(input.taskId, device.ownerId);
  if (!task) return { ok: false as const, status: 404, error: "任务不存在" };
  if (terminalTaskStatuses.has(task.status)) {
    assignment.status = task.status === "cancelled" ? "cancelled" : "failed";
    assignment.error = `任务已进入终态：${task.status}`;
    assignment.completedAt = new Date().toISOString();
    assignment.updatedAt = assignment.completedAt;
    return { ok: false as const, status: 409, error: assignment.error };
  }

  const allowedTypes = new Set<AgentEventType>([
    "thinking",
    "plan",
    "tool_call",
    "tool_result",
    "message",
    "artifact"
  ]);
  const type = input.type && allowedTypes.has(input.type) ? input.type : "message";
  assignment.updatedAt = new Date().toISOString();
  addTaskEvent(task.id, {
    type,
    stepIndex: task.events.length + 1,
    title: input.title?.trim().slice(0, 120) || "桌面端执行进度",
    content: input.content?.trim().slice(0, 2000),
    payload: {
      assignmentId: assignment.id,
      deviceId: device.id,
      source: "desktop",
      ...(input.payload && typeof input.payload === "object" ? input.payload : {})
    }
  });

  return { ok: true as const, assignment: publicDesktopAssignment(assignment), task: getTask(task.id, device.ownerId) };
}

export function completeMyComputerDesktopTask(input: {
  token?: string;
  taskId: string;
  ok: boolean;
  finalAnswer?: string;
  error?: string;
  artifacts?: Array<{
    name: string;
    type: "txt" | "md" | "json";
    mimeType: string;
    content: string;
  }>;
}) {
  const device = resolveMyComputerDesktopDeviceToken(input.token);
  if (!device) return { ok: false as const, status: 401, error: "桌面端未配对或令牌已失效。" };
  const assignment = desktopTaskAssignments().find(
    (candidate) =>
      candidate.ownerId === device.ownerId &&
      candidate.deviceId === device.id &&
      candidate.taskId === input.taskId &&
      (candidate.status === "queued" || candidate.status === "assigned")
  );
  if (!assignment) return { ok: false as const, status: 404, error: "桌面端任务不存在或已完成。" };
  const task = getTask(input.taskId, device.ownerId);
  if (!task) return { ok: false as const, status: 404, error: "任务不存在" };
  if (terminalTaskStatuses.has(task.status)) {
    assignment.status = task.status === "cancelled" ? "cancelled" : "failed";
    assignment.completedAt = new Date().toISOString();
    assignment.updatedAt = assignment.completedAt;
    assignment.error = `任务已进入终态：${task.status}`;
    return { ok: false as const, status: 409, error: assignment.error };
  }

  const now = new Date().toISOString();
  assignment.status = input.ok ? "completed" : "failed";
  assignment.completedAt = now;
  assignment.updatedAt = now;
  assignment.error = input.ok ? undefined : input.error ?? "桌面端执行失败";

  if (input.ok) {
    const finalAnswer =
      input.finalAnswer?.trim() ||
      `My Computer 桌面端 ${device.name} 已完成任务。`;
    setFinalAnswer(task.id, finalAnswer);
    addArtifact(task.id, {
      name: "my-computer-desktop-result.md",
      type: "md",
      mimeType: "text/markdown",
      content: `# My Computer Desktop Result\n\n${finalAnswer}\n`
    });
    input.artifacts?.slice(0, 5).forEach((artifact) => addArtifact(task.id, artifact));
    addTaskEvent(task.id, {
      type: "finished",
      stepIndex: task.events.length + 1,
      title: "桌面端任务完成",
      content: finalAnswer,
      payload: {
        assignmentId: assignment.id,
        deviceId: device.id
      }
    });
    updateTaskStatus(task.id, "completed");
  } else {
    const message = input.error ?? "桌面端执行失败";
    addTaskEvent(task.id, {
      type: "failed",
      stepIndex: task.events.length + 1,
      title: "桌面端任务失败",
      content: message,
      payload: {
        assignmentId: assignment.id,
        deviceId: device.id
      }
    });
    updateTaskStatus(task.id, "failed", message);
  }

  safeRecordAuditLog({
    userId: device.ownerId,
    taskId: task.id,
    action: "my_computer.desktop_task.complete",
    resource: `desktop:${device.id}`,
    status: input.ok ? "completed" : "failed",
    metadata: {
      assignmentId: assignment.id,
      deviceName: device.name,
      error: input.error
    }
  });

  return { ok: true as const, assignment: publicDesktopAssignment(assignment), task: getTask(task.id, device.ownerId) };
}

export function cancelMyComputerDesktopTask(taskId: string, ownerId: string) {
  const now = new Date().toISOString();
  const assignments = desktopTaskAssignments().filter(
    (assignment) =>
      assignment.taskId === taskId &&
      assignment.ownerId === ownerId &&
      (assignment.status === "queued" || assignment.status === "assigned")
  );
  assignments.forEach((assignment) => {
    assignment.status = "cancelled";
    assignment.completedAt = now;
    assignment.updatedAt = now;
    assignment.error = "用户取消了当前任务。";
    safeRecordAuditLog({
      userId: ownerId,
      taskId,
      action: "my_computer.desktop_task.cancel",
      resource: `desktop:${assignment.deviceId}`,
      status: "completed",
      metadata: {
        assignmentId: assignment.id
      }
    });
  });
  return assignments.map(publicDesktopAssignment);
}

export function cancelMyComputerDesktopTaskFromDevice(input: {
  token?: string;
  taskId: string;
}) {
  const device = resolveMyComputerDesktopDeviceToken(input.token);
  if (!device) return { ok: false as const, status: 401, error: "桌面端未配对或令牌已失效。" };
  const assignment = desktopTaskAssignments().find(
    (candidate) =>
      candidate.taskId === input.taskId &&
      candidate.ownerId === device.ownerId &&
      candidate.deviceId === device.id &&
      (candidate.status === "queued" || candidate.status === "assigned")
  );
  if (!assignment) return { ok: false as const, status: 404, error: "桌面端任务不存在或已完成。" };
  const task = getTask(input.taskId, device.ownerId);
  if (!task) return { ok: false as const, status: 404, error: "任务不存在" };
  if (terminalTaskStatuses.has(task.status)) {
    assignment.status = task.status === "cancelled" ? "cancelled" : "failed";
    assignment.completedAt = new Date().toISOString();
    assignment.updatedAt = assignment.completedAt;
    assignment.error = `任务已进入终态：${task.status}`;
    return { ok: false as const, status: 409, error: assignment.error };
  }

  const now = new Date().toISOString();
  assignment.status = "cancelled";
  assignment.completedAt = now;
  assignment.updatedAt = now;
  assignment.error = "桌面端停止了当前任务。";
  updateTaskStatus(task.id, "cancelled");
  addTaskEvent(task.id, {
    type: "failed",
    stepIndex: task.events.length + 1,
    title: "桌面端已停止任务",
    content: `${device.name} 停止了当前 My Computer 任务。`,
    payload: {
      assignmentId: assignment.id,
      deviceId: device.id
    }
  });
  safeRecordAuditLog({
    userId: device.ownerId,
    taskId: task.id,
    action: "my_computer.desktop_task.cancel_from_device",
    resource: `desktop:${device.id}`,
    status: "completed",
    metadata: {
      assignmentId: assignment.id,
      deviceName: device.name
    }
  });

  return { ok: true as const, assignment: publicDesktopAssignment(assignment), task: getTask(task.id, device.ownerId) };
}

export function createMyComputerDesktopPairingCode(ownerId: string): MyComputerDesktopPairingStatus {
  const active = cleanExpiredDesktopPairingCodes().filter((record) => record.ownerId !== ownerId);
  const record: DesktopPairingCodeRecord = {
    code: makeDesktopPairingCode(),
    ownerId,
    expiresAt: new Date(nowMs() + desktopPairingTtlMs).toISOString()
  };
  globalForMyComputer.manusxlMyComputerDesktopPairingCodes = [record, ...active];
  return getMyComputerDesktopPairingStatus(ownerId);
}

export function getMyComputerDesktopPairingStatus(ownerId: string): MyComputerDesktopPairingStatus {
  const active = cleanExpiredDesktopPairingCodes().find((record) => record.ownerId === ownerId);
  return {
    activeCode: active ? { code: active.code, expiresAt: active.expiresAt } : undefined,
    pairedDevices: listDesktopDevicesForOwner(ownerId)
  };
}

export function verifyMyComputerDesktopPairingCode(input: {
  code?: string;
  deviceName?: string;
  bridge?: MyComputerBridgeType;
  platform?: string;
  appVersion?: string;
  capabilities?: MyComputerOperationKind[];
  metadata?: Record<string, string | number | boolean>;
}): MyComputerDesktopPairingVerifyResponse {
  const normalized = normalizePairingCode(input.code ?? "");
  const record = cleanExpiredDesktopPairingCodes().find(
    (candidate) => normalizePairingCode(candidate.code) === normalized
  );
  if (!record) {
    return {
      paired: false,
      error: "桌面端配对码无效或已过期。"
    };
  }

  const token = makeDesktopDeviceToken();
  const now = new Date().toISOString();
  const bridge = input.bridge === "tauri" ? "tauri" : "electron";
  const device: DesktopDeviceRecord = {
    id: createId("mcdev"),
    ownerId: record.ownerId,
    name: (input.deviceName || "ManusXL Desktop").trim().slice(0, 80),
    bridge,
    platform: (input.platform || process.platform).trim().slice(0, 40),
    appVersion: (input.appVersion || "0.1.0").trim().slice(0, 40),
    capabilities: Array.from(new Set(input.capabilities ?? [])).filter((capability) =>
      [
        "file_scan",
        "file_classify",
        "file_dedupe",
        "file_rename",
        "file_move",
        "file_undo",
        "app_launch",
        "app_quit",
        "clipboard_write",
        "clipboard_read",
        "keyboard_shortcut",
        "mouse_click",
        "terminal_command"
      ].includes(capability)
    ),
    metadata: input.metadata,
    tokenHash: hashDesktopDeviceToken(token),
    createdAt: now,
    lastSeenAt: now
  };
  const remainingCodes = cleanExpiredDesktopPairingCodes().filter((candidate) => candidate.code !== record.code);
  const remainingDevices = desktopDeviceRecords()
    .filter((candidate) => candidate.ownerId !== record.ownerId || candidate.name !== device.name)
    .slice(0, maxDesktopDevices - 1);
  globalForMyComputer.manusxlMyComputerDesktopPairingCodes = remainingCodes;
  globalForMyComputer.manusxlMyComputerDesktopDevices = [device, ...remainingDevices];

  return {
    paired: true,
    token,
    device: publicDesktopDevice(device)
  };
}

export function resolveMyComputerDesktopDeviceToken(token?: string) {
  if (!token) return undefined;
  const hash = hashDesktopDeviceToken(token);
  const record = desktopDeviceRecords().find((candidate) => candidate.tokenHash === hash);
  if (!record) return undefined;
  record.lastSeenAt = new Date().toISOString();
  return record;
}

export async function heartbeatMyComputerDesktopDevice(input: {
  token?: string;
  capabilities?: MyComputerOperationKind[];
  appVersion?: string;
  platform?: string;
  metadata?: Record<string, string | number | boolean>;
}): Promise<MyComputerDesktopHeartbeatResponse> {
  const record = resolveMyComputerDesktopDeviceToken(input.token);
  if (!record) {
    return { ok: false, error: "桌面端未配对或令牌已失效。" };
  }
  if (input.capabilities) {
    record.capabilities = Array.from(new Set(input.capabilities));
  }
  if (input.appVersion) record.appVersion = input.appVersion.trim().slice(0, 40);
  if (input.platform) record.platform = input.platform.trim().slice(0, 40);
  if (input.metadata) record.metadata = input.metadata;
  record.lastSeenAt = new Date().toISOString();
  const status = await getMyComputerStatus(record.ownerId);
  return {
    ok: true,
    device: publicDesktopDevice(record),
    paused: status.paused,
    allowedRoots: status.allowedRoots,
    pendingApprovals: status.pendingApprovals,
    recentOperations: status.recentOperations,
    assignedTasks: desktopAssignmentsForOwner(record.ownerId),
    fileRequests: pendingDesktopFileRequestsForDevice(record)
  };
}

function expandHome(value: string) {
  return value.replace(/^~(?=$|\/|\\)/, homedir());
}

function configuredDefaultRoot() {
  const root = resolve(dataPath("my-computer", "workspace"));
  return root;
}

function normalizeRoot(value: string) {
  return resolve(expandHome(value.trim()));
}

function isDangerousRoot(root: string) {
  return dangerousRootPatterns.some((pattern) => pattern.test(root));
}

function configuredAllowedRoots() {
  const configured = getMyComputerAllowedRoots()
    .map(normalizeRoot)
    .filter((root) => !isDangerousRoot(root));
  const roots = configured.length > 0 ? configured : [configuredDefaultRoot()];
  return Array.from(new Set(roots));
}

export async function ensureMyComputerDefaultRoot() {
  await mkdir(configuredDefaultRoot(), { recursive: true });
}

function isPathInsideRoot(root: string, target: string) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  const diff = relative(normalizedRoot, normalizedTarget);
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}

function assertAllowedPath(pathname: string) {
  const target = resolve(expandHome(pathname));
  const roots = configuredAllowedRoots();
  const root = roots.find((candidate) => isPathInsideRoot(candidate, target));
  if (!root) {
    throw new Error(`路径不在 My Computer 允许目录内：${target}`);
  }
  return { root, target };
}

function normalizeTargetPath(pathname?: string) {
  if (!pathname?.trim()) return configuredDefaultRoot();
  return resolve(expandHome(pathname));
}

function fileCategory(filePath: string) {
  return categoryByExtension[extname(filePath).toLowerCase()] ?? "other";
}

function makeOperation(input: {
  ownerId?: string;
  kind: MyComputerOperationKind;
  target: string;
  description: string;
  dryRun?: boolean;
  requiresApproval?: boolean;
  actions?: MyComputerFileAction[];
  result?: Record<string, unknown>;
  status?: MyComputerOperation["status"];
}) {
  const now = new Date().toISOString();
  const operation: MyComputerOperation = {
    id: createId("mcop"),
    ownerId: input.ownerId,
    kind: input.kind,
    target: input.target,
    description: input.description,
    dryRun: input.dryRun ?? true,
    requiresApproval: input.requiresApproval ?? true,
    status: input.status ?? "planned",
    actions: input.actions,
    result: input.result,
    createdAt: now,
    updatedAt: now
  };
  operationList().unshift(operation);
  if (operationList().length > maxRecentOperations) operationList().length = maxRecentOperations;
  auditOperation(operation, "started");
  return operation;
}

function updateOperation(operationId: string, patch: Partial<MyComputerOperation>) {
  const operation = operationList().find((candidate) => candidate.id === operationId);
  if (!operation) return undefined;
  Object.assign(operation, patch, { updatedAt: new Date().toISOString() });
  return operation;
}

function approvalKey(kind: MyComputerOperationKind, target: string) {
  const normalizedTarget = kind.startsWith("file_") ? assertAllowedPath(target).root : target;
  return `${kind}:${normalizedTarget}`;
}

function systemOperationTarget(
  kind: MyComputerOperationKind,
  input: {
    target?: string;
    text?: string;
    command?: string;
    x?: number;
    y?: number;
  }
) {
  if (kind === "clipboard_write" || kind === "clipboard_read") return "clipboard";
  if (kind === "mouse_click") return `screen:${input.x ?? 0},${input.y ?? 0}`;
  if (kind === "terminal_command") return (input.command ?? "").trim();
  return (input.target ?? input.text ?? "").trim();
}

function auditOperation(operation: MyComputerOperation, auditStatus: "started" | "completed" | "failed" | "blocked") {
  if (!operation.ownerId) return;
  safeRecordAuditLog({
    userId: operation.ownerId,
    action: `my_computer.${operation.kind}`,
    resource: operation.target,
    status: auditStatus,
    metadata: {
      operationId: operation.id,
      description: operation.description,
      dryRun: operation.dryRun,
      actionCount: operation.actions?.length ?? 0,
      error: operation.error
    }
  });
}

function isUndoableFileOperation(operation: MyComputerOperation, ownerId?: string) {
  if (ownerId && operation.ownerId !== ownerId) return false;
  if (operation.status !== "completed") return false;
  if (!undoableFileKinds.has(operation.kind)) return false;
  const applied = operation.result?.applied;
  return Array.isArray(applied) && applied.length > 0;
}

function appliedActionsFromOperation(operation: MyComputerOperation) {
  const applied = operation.result?.applied;
  if (!Array.isArray(applied)) return [];
  return applied.filter((item): item is MyComputerFileAction => {
    if (!item || typeof item !== "object") return false;
    const action = item as Partial<MyComputerFileAction>;
    return typeof action.sourcePath === "string" && typeof action.targetPath === "string";
  });
}

export async function updateMyComputerSettings(input: {
  allowedRoots?: string[];
  paused?: boolean;
  alwaysAllowRules?: string[];
}) {
  const allowedRoots = input.allowedRoots?.map(normalizeRoot).filter((root) => !isDangerousRoot(root));
  if (input.alwaysAllowRules !== undefined) {
    globalForMyComputer.manusxlMyComputerAlwaysAllow = new Set(input.alwaysAllowRules);
  }
  updateAppConfig({
    myComputerAllowedRoots: allowedRoots,
    myComputerPaused: input.paused,
    myComputerAlwaysAllowRules: input.alwaysAllowRules
  });
  await ensureMyComputerDefaultRoot();
  return getMyComputerStatus();
}

export async function getMyComputerStatus(ownerId?: string): Promise<MyComputerStatus> {
  await ensureMyComputerDefaultRoot();
  const roots = configuredAllowedRoots();
  const operations = ownerId
    ? operationList().filter((operation) => !operation.ownerId || operation.ownerId === ownerId)
    : operationList();
  const desktopDevices = listDesktopDevicesForOwner(ownerId);
  const onlineDesktop = desktopDevices.find((device) => device.status === "online");
  return {
    connected: true,
    bridge: onlineDesktop?.bridge ?? "next-local",
    platform: process.platform,
    paused: isMyComputerPaused(),
    allowedRoots: roots,
    capabilities: [
      {
        id: "desktop_bridge",
        label: "桌面端桥接",
        ready: true,
        requiresApproval: false,
        note: "当前使用本地 Next.js 进程作为 My Computer MVP 桥接，后续可抽到 Electron/Tauri。"
      },
      {
        id: "file_classify",
        label: "文件分类/移动",
        ready: true,
        requiresApproval: true,
        note: "支持 dry-run 预览，确认后仅在允许目录内移动。"
      },
      {
        id: "file_dedupe",
        label: "文件查重",
        ready: true,
        requiresApproval: true,
        note: "按内容 hash 识别重复文件，并移动到隔离目录。"
      },
      {
        id: "file_undo",
        label: "文件撤销",
        ready: operations.some((operation) => isUndoableFileOperation(operation, ownerId)),
        requiresApproval: true,
        note: "可撤销最近一次已完成的批量移动/重命名。"
      },
      {
        id: "app_launch",
        label: "应用启动",
        ready: process.platform === "darwin" || process.platform === "win32" || process.platform === "linux",
        requiresApproval: true,
        note: "macOS 使用 open -a，Windows/Linux 使用平台命令。"
      },
      {
        id: "app_quit",
        label: "应用关闭",
        ready: process.platform === "darwin" || process.platform === "win32" || process.platform === "linux",
        requiresApproval: true,
        note: "macOS 使用 osascript，Windows/Linux 使用平台命令。"
      },
      {
        id: "clipboard_write",
        label: "剪贴板写入",
        ready: true,
        requiresApproval: true,
        note: "macOS 使用 pbcopy；不可用时写入本地回退文件。"
      },
      {
        id: "clipboard_read",
        label: "剪贴板读取",
        ready: true,
        requiresApproval: true,
        note: "macOS 使用 pbpaste；不可用时读取本地回退文件。"
      },
      {
        id: "keyboard_shortcut",
        label: "键盘快捷键",
        ready: process.platform === "darwin",
        requiresApproval: true,
        note: "MVP 仅 macOS 可用，依赖辅助功能权限。"
      },
      {
        id: "mouse_click",
        label: "鼠标点击",
        ready: false,
        requiresApproval: true,
        note: "MVP 先提供授权和 dry-run；真实点击后续接 nut.js 或 cliclick。"
      },
      {
        id: "terminal_command",
        label: "本机命令",
        ready: true,
        requiresApproval: true,
        note: "仅允许短时白名单命令，cwd 固定在 My Computer 允许目录。"
      }
    ],
    recentOperations: operations.slice(0, 20),
    pendingApprovals: operations.filter((operation) => operation.status === "pending_approval").slice(0, 20),
    desktopDevices
  };
}

export async function scanMyComputerFiles(input: {
  ownerId?: string;
  root?: string;
  maxFiles?: number;
  maxDepth?: number;
  request?: Request;
}): Promise<MyComputerFileScanResponse> {
  if (isMyComputerPaused()) throw new Error("My Computer 已暂停。");
  const root = normalizeTargetPath(input.root);
  const allowed = assertAllowedPath(root);
  await access(allowed.target, constants.R_OK);

  const maxFiles = Math.max(1, Math.min(input.maxFiles ?? 200, 1000));
  const maxDepth = Math.max(0, Math.min(input.maxDepth ?? 3, 8));
  const entries: MyComputerFileEntry[] = [];
  let truncated = false;

  async function walk(directory: string, depth: number) {
    if (entries.length >= maxFiles) {
      truncated = true;
      return;
    }
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      if (entries.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (child.name.startsWith(".") || child.isSymbolicLink()) continue;
      const childPath = join(directory, child.name);
      if (!isPathInsideRoot(allowed.root, childPath)) continue;
      const childStat = await stat(childPath);
      const isDirectory = child.isDirectory();
      entries.push({
        path: childPath,
        name: child.name,
        extension: isDirectory ? "" : extname(child.name).toLowerCase(),
        kind: isDirectory ? "directory" : "file",
        size: childStat.size,
        modifiedAt: childStat.mtime.toISOString(),
        category: isDirectory ? "folder" : fileCategory(childPath)
      });
      if (isDirectory && depth < maxDepth) {
        await walk(childPath, depth + 1);
      }
    }
  }

  await walk(allowed.target, 0);
  const operation = makeOperation({
    ownerId: input.ownerId,
    kind: "file_scan",
    target: allowed.target,
    description: `扫描 ${basename(allowed.target) || allowed.target}`,
    dryRun: true,
    requiresApproval: false,
    status: "completed",
    result: {
      total: entries.length,
      truncated
    }
  });
  auditOperation(operation, "completed");
  if (input.request && input.ownerId) {
    safeRecordAuditLog({
      userId: input.ownerId,
      action: "my_computer.file_scan.request",
      resource: allowed.target,
      status: "completed",
      ...requestAuditContext(input.request),
      metadata: { total: entries.length, truncated }
    });
  }
  return {
    root: allowed.target,
    total: entries.length,
    truncated,
    entries
  };
}

function uniqueTarget(sourcePath: string, targetPath: string, reserved: Set<string>) {
  const extension = extname(targetPath);
  const base = targetPath.slice(0, targetPath.length - extension.length);
  let candidate = targetPath;
  let index = 2;
  while (candidate === sourcePath || reserved.has(candidate)) {
    candidate = `${base}-${index}${extension}`;
    index += 1;
  }
  reserved.add(candidate);
  return candidate;
}

async function hashFile(pathname: string) {
  const fileStat = await stat(pathname);
  if (fileStat.size > maxFileHashBytes) return undefined;
  const buffer = await readFile(pathname);
  return createHash("sha256").update(buffer).digest("hex");
}

function isoDatePrefix(value: string) {
  return value.slice(0, 10);
}

export async function planMyComputerFileOperation(input: {
  ownerId?: string;
  root?: string;
  mode: MyComputerFilePlanMode;
  maxFiles?: number;
}): Promise<MyComputerFilePlanResponse> {
  const scan = await scanMyComputerFiles({
    ownerId: input.ownerId,
    root: input.root,
    maxFiles: input.maxFiles ?? 300,
    maxDepth: 1
  });
  const root = scan.root;
  const files = scan.entries.filter((entry) => entry.kind === "file");
  const actions: MyComputerFileAction[] = [];
  const reservedTargets = new Set<string>();

  if (input.mode === "classify") {
    for (const file of files) {
      const category = file.category || "other";
      const target = uniqueTarget(
        file.path,
        join(root, "ManusXL Sorted", category, file.name),
        reservedTargets
      );
      if (target !== file.path) {
        actions.push({
          id: createId("mcact"),
          type: "move",
          sourcePath: file.path,
          targetPath: target,
          reason: `按文件类型归类到 ${category}`
        });
      }
    }
  }

  if (input.mode === "rename") {
    for (const file of files) {
      const safeName = file.name
        .replace(/[/:*?"<>|\\]/g, "_")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
      const target = uniqueTarget(
        file.path,
        join(dirname(file.path), `${isoDatePrefix(file.modifiedAt)}-${safeName}`),
        reservedTargets
      );
      if (target !== file.path) {
        actions.push({
          id: createId("mcact"),
          type: "rename",
          sourcePath: file.path,
          targetPath: target,
          reason: "规范化文件名并加入修改日期前缀"
        });
      }
    }
  }

  if (input.mode === "dedupe") {
    const bySize = new Map<number, MyComputerFileEntry[]>();
    for (const file of files) {
      if (file.size <= 0 || file.size > maxFileHashBytes) continue;
      const group = bySize.get(file.size) ?? [];
      group.push(file);
      bySize.set(file.size, group);
    }
    let groupIndex = 1;
    for (const group of bySize.values()) {
      if (group.length < 2) continue;
      const byHash = new Map<string, MyComputerFileEntry[]>();
      for (const file of group) {
        const hash = await hashFile(file.path);
        if (!hash) continue;
        file.hash = hash;
        const hashGroup = byHash.get(hash) ?? [];
        hashGroup.push(file);
        byHash.set(hash, hashGroup);
      }
      for (const duplicates of byHash.values()) {
        if (duplicates.length < 2) continue;
        const [keeper, ...rest] = duplicates.sort((left, right) => left.path.localeCompare(right.path));
        const duplicateGroupId = `dup-${groupIndex}`;
        groupIndex += 1;
        for (const duplicate of rest) {
          const target = uniqueTarget(
            duplicate.path,
            join(root, "ManusXL Duplicates", duplicateGroupId, basename(duplicate.path)),
            reservedTargets
          );
          actions.push({
            id: createId("mcact"),
            type: "move",
            sourcePath: duplicate.path,
            targetPath: target,
            reason: `内容 hash 与 ${basename(keeper.path)} 一致，移入重复文件隔离区`,
            duplicateGroupId
          });
        }
      }
    }
  }

  const kind: MyComputerOperationKind =
    input.mode === "dedupe" ? "file_dedupe" : input.mode === "rename" ? "file_rename" : "file_classify";
  const operation = makeOperation({
    ownerId: input.ownerId,
    kind,
    target: root,
    description: `${input.mode} dry-run：${actions.length} 个文件动作等待确认`,
    dryRun: true,
    requiresApproval: actions.length > 0,
    actions,
    status: actions.length > 0 ? "pending_approval" : "completed",
    result: {
      scannedFiles: files.length,
      mode: input.mode
    }
  });
  if (actions.length === 0) auditOperation(operation, "completed");
  return {
    operation,
    summary: {
      mode: input.mode,
      actionCount: actions.length,
      affectedFiles: new Set(actions.map((action) => action.sourcePath)).size
    }
  };
}

export async function approveAndRunMyComputerOperation(input: {
  ownerId?: string;
  operationId: string;
  decision: MyComputerApprovalDecision;
}) {
  const operation = operationList().find(
    (candidate) => candidate.id === input.operationId && (!input.ownerId || candidate.ownerId === input.ownerId)
  );
  if (!operation) throw new Error("My Computer 操作不存在或已过期。");

  if (input.decision === "deny") {
    const blocked = updateOperation(operation.id, {
      status: "blocked",
      approvalDecision: input.decision,
      error: "用户拒绝执行"
    })!;
    auditOperation(blocked, "blocked");
    return blocked;
  }

  if (input.decision === "always") {
    alwaysAllowSet().add(approvalKey(operation.kind, operation.target));
    persistAlwaysAllowRules();
  }

  if (operation.actions?.length) {
    return await executeFileActions(operation, input.decision);
  }
  return await executeSystemOperation(operation, input.decision);
}

async function executeFileActions(operation: MyComputerOperation, decision: MyComputerApprovalDecision) {
  if (isMyComputerPaused()) throw new Error("My Computer 已暂停。");
  assertAllowedPath(operation.target);
  const actions = operation.actions ?? [];
  const applied: MyComputerFileAction[] = [];
  updateOperation(operation.id, {
    status: "approved",
    approvalDecision: decision
  });

  try {
    for (const action of actions) {
      assertAllowedPath(action.sourcePath);
      assertAllowedPath(action.targetPath);
      await mkdir(dirname(action.targetPath), { recursive: true });
      await rename(action.sourcePath, action.targetPath);
      applied.push(action);
    }
    const completed = updateOperation(operation.id, {
      status: "completed",
      dryRun: false,
      result: {
        appliedActions: applied.length,
        applied
      }
    })!;
    auditOperation(completed, "completed");
    return completed;
  } catch (error) {
    const failed = updateOperation(operation.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      result: {
        appliedActions: applied.length,
        applied
      }
    })!;
    auditOperation(failed, "failed");
    return failed;
  }
}

export async function undoMyComputerFileOperation(input: {
  ownerId?: string;
  operationId?: string;
}) {
  if (isMyComputerPaused()) throw new Error("My Computer 已暂停。");
  const targetOperation = operationList().find((operation) =>
    input.operationId
      ? operation.id === input.operationId && (!input.ownerId || operation.ownerId === input.ownerId)
      : isUndoableFileOperation(operation, input.ownerId)
  );
  if (!targetOperation) throw new Error("没有可撤销的 My Computer 文件操作。");
  if (!isUndoableFileOperation(targetOperation, input.ownerId)) {
    throw new Error("该 My Computer 文件操作当前不可撤销。");
  }

  const applied = appliedActionsFromOperation(targetOperation);
  if (applied.length === 0) throw new Error("该操作没有可恢复的文件动作。");

  const undoOperation = makeOperation({
    ownerId: input.ownerId,
    kind: "file_undo",
    target: targetOperation.target,
    description: `撤销 ${targetOperation.description}`,
    dryRun: false,
    requiresApproval: false,
    actions: applied.map((action) => ({
      ...action,
      id: createId("mcundo"),
      sourcePath: action.targetPath,
      targetPath: action.sourcePath,
      reason: `撤销：${action.reason}`
    })),
    status: "approved",
    result: {
      sourceOperationId: targetOperation.id
    }
  });

  const restored: MyComputerFileAction[] = [];
  try {
    for (const action of [...applied].reverse()) {
      assertAllowedPath(action.sourcePath);
      assertAllowedPath(action.targetPath);
      await access(action.targetPath, constants.F_OK);
      try {
        await access(action.sourcePath, constants.F_OK);
        throw new Error(`撤销目标已存在，已停止以避免覆盖：${action.sourcePath}`);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
      }
      await mkdir(dirname(action.sourcePath), { recursive: true });
      await rename(action.targetPath, action.sourcePath);
      restored.push(action);
    }

    const completed = updateOperation(undoOperation.id, {
      status: "completed",
      result: {
        sourceOperationId: targetOperation.id,
        restoredActions: restored.length,
        restored
      }
    })!;
    updateOperation(targetOperation.id, { status: "undone" });
    auditOperation(completed, "completed");
    return completed;
  } catch (error) {
    const failed = updateOperation(undoOperation.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      result: {
        sourceOperationId: targetOperation.id,
        restoredActions: restored.length,
        restored
      }
    })!;
    auditOperation(failed, "failed");
    return failed;
  }
}

export async function createMyComputerSystemOperation(input: {
  ownerId?: string;
  kind: Extract<
    MyComputerOperationKind,
    "app_launch" | "app_quit" | "clipboard_write" | "keyboard_shortcut" | "mouse_click" | "terminal_command"
    | "clipboard_read"
  >;
  target?: string;
  text?: string;
  command?: string;
  args?: string[];
  x?: number;
  y?: number;
  dryRun?: boolean;
  decision?: MyComputerApprovalDecision;
}) {
  if (isMyComputerPaused()) throw new Error("My Computer 已暂停。");
  const target = systemOperationTarget(input.kind, input) || input.kind;
  const key = approvalKey(input.kind, target || input.kind);
  const alreadyAllowed = alwaysAllowSet().has(key);
  const shouldExecute = alreadyAllowed || (input.dryRun === false && Boolean(input.decision));
  const operation = makeOperation({
    ownerId: input.ownerId,
    kind: input.kind,
    target: target || input.kind,
    description: describeSystemOperation(input.kind, input),
    dryRun: !shouldExecute,
    requiresApproval: true,
    status: shouldExecute ? "approved" : "pending_approval",
    result: {
      text: input.text,
      command: input.command,
      args: input.args,
      x: input.x,
      y: input.y
    }
  });

  if (!shouldExecute) return operation;
  return await executeSystemOperation(operation, input.decision ?? "always");
}

function describeSystemOperation(
  kind: MyComputerOperationKind,
  input: {
    target?: string;
    text?: string;
    command?: string;
    args?: string[];
    x?: number;
    y?: number;
  }
) {
  if (kind === "app_launch") return `启动应用：${input.target ?? "unknown"}`;
  if (kind === "app_quit") return `关闭应用：${input.target ?? "unknown"}`;
  if (kind === "clipboard_write") return `写入剪贴板：${input.text?.slice(0, 40) ?? ""}`;
  if (kind === "clipboard_read") return "读取剪贴板";
  if (kind === "keyboard_shortcut") return `发送键盘快捷键：${input.target ?? input.text ?? ""}`;
  if (kind === "mouse_click") return `鼠标点击：${input.x ?? 0}, ${input.y ?? 0}`;
  if (kind === "terminal_command") return `执行终端命令：${input.command ?? ""}`;
  return kind;
}

async function executeSystemOperation(operation: MyComputerOperation, decision: MyComputerApprovalDecision) {
  updateOperation(operation.id, {
    status: "approved",
    approvalDecision: decision,
    dryRun: false
  });
  try {
    const result = await runSystemOperation(operation);
    const completed = updateOperation(operation.id, {
      status: "completed",
      result
    })!;
    auditOperation(completed, "completed");
    return completed;
  } catch (error) {
    const failed = updateOperation(operation.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    })!;
    auditOperation(failed, "failed");
    return failed;
  }
}

async function runSystemOperation(operation: MyComputerOperation) {
  const detail = operation.result ?? {};
  if (operation.kind === "app_launch") {
    return await launchApplication(operation.target);
  }
  if (operation.kind === "app_quit") {
    return await quitApplication(operation.target);
  }
  if (operation.kind === "clipboard_write") {
    return await writeClipboard(String(detail.text ?? operation.target));
  }
  if (operation.kind === "clipboard_read") {
    return await readClipboard();
  }
  if (operation.kind === "keyboard_shortcut") {
    return await sendKeyboardShortcut(operation.target);
  }
  if (operation.kind === "mouse_click") {
    throw new Error("鼠标点击执行需要接入 nut.js 或 cliclick；当前 MVP 只提供授权和 dry-run。");
  }
  if (operation.kind === "terminal_command") {
    return await runTerminalCommand(operation);
  }
  return {};
}

async function launchApplication(target: string) {
  if (!target.trim()) throw new Error("缺少应用名称。");
  if (process.platform === "darwin") {
    await execFileAsync("open", ["-a", target], { timeout: 8000 });
    return { launched: target, platform: process.platform };
  }
  if (process.platform === "win32") {
    await execFileAsync("cmd.exe", ["/c", "start", "", target], { timeout: 8000 });
    return { launched: target, platform: process.platform };
  }
  await execFileAsync("xdg-open", [target], { timeout: 8000 });
  return { launched: target, platform: process.platform };
}

function appleScriptString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function quitApplication(target: string) {
  if (!target.trim()) throw new Error("缺少应用名称。");
  if (process.platform === "darwin") {
    const appName = appleScriptString(target);
    await execFileAsync("osascript", ["-e", `tell application "${appName}" to quit`], { timeout: 8000 });
    return { quit: target, platform: process.platform };
  }
  if (process.platform === "win32") {
    const imageName = target.toLowerCase().endsWith(".exe") ? target : `${target}.exe`;
    await execFileAsync("taskkill", ["/IM", imageName, "/F"], { timeout: 8000 });
    return { quit: target, platform: process.platform };
  }
  await execFileAsync("pkill", ["-f", target], { timeout: 8000 });
  return { quit: target, platform: process.platform };
}

async function writeClipboard(text: string) {
  if (process.platform === "darwin") {
    await new Promise<void>((resolvePromise, reject) => {
      const child = execFile("pbcopy", [], (error) => {
        if (error) reject(error);
        else resolvePromise();
      });
      child.stdin?.end(text);
    });
    return { clipboard: "pbcopy", size: text.length };
  }

  const fallbackPath = resolve(dataPath("my-computer", "clipboard.txt"));
  await mkdir(dirname(fallbackPath), { recursive: true });
  await writeFile(fallbackPath, text, "utf8");
  return { clipboard: "file-fallback", path: fallbackPath, size: text.length };
}

async function readClipboard() {
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("pbpaste", [], {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    const text = stdout.toString();
    return { clipboard: "pbpaste", text, size: text.length };
  }

  const fallbackPath = resolve(dataPath("my-computer", "clipboard.txt"));
  try {
    const text = await readFile(fallbackPath, "utf8");
    return { clipboard: "file-fallback", path: fallbackPath, text, size: text.length };
  } catch {
    return { clipboard: "file-fallback", path: fallbackPath, text: "", size: 0 };
  }
}

function splitCommandLine(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
}

function validateTerminalArg(arg: string, cwd: string) {
  if (arg.length > 160) throw new Error("命令参数过长。");
  if (/[\0\r\n;&|<>`$]/.test(arg)) throw new Error("命令参数包含不安全字符。");
  if (arg.startsWith("-")) return arg;
  const resolved = resolve(cwd, expandHome(arg));
  if (arg.includes("/") || arg.includes("\\")) {
    assertAllowedPath(resolved);
  }
  return arg;
}

async function runTerminalCommand(operation: MyComputerOperation) {
  const detail = operation.result ?? {};
  const rawCommand = String(detail.command ?? operation.target).trim();
  const providedArgs = Array.isArray(detail.args) ? detail.args.map(String) : undefined;
  const parts = providedArgs ? [rawCommand, ...providedArgs] : splitCommandLine(rawCommand);
  const command = basename(parts[0] ?? "");
  if (!allowedTerminalCommands.has(command)) {
    throw new Error(`本机命令未加入 My Computer 白名单：${command || "empty"}`);
  }

  const cwd = configuredAllowedRoots()[0];
  await mkdir(cwd, { recursive: true });
  assertAllowedPath(cwd);
  const args = parts.slice(1).map((arg) => validateTerminalArg(arg, cwd));
  const startedAt = Date.now();
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    timeout: terminalTimeoutMs,
    maxBuffer: terminalMaxBuffer
  });
  return {
    command,
    args,
    cwd,
    exitCode: 0,
    stdout: stdout.toString().slice(0, 12000),
    stderr: stderr.toString().slice(0, 12000),
    durationMs: Date.now() - startedAt
  };
}

async function sendKeyboardShortcut(shortcut: string) {
  if (process.platform !== "darwin") {
    throw new Error("键盘快捷键 MVP 目前仅支持 macOS。");
  }
  const normalized = shortcut.trim();
  if (!/^[a-z0-9+ _-]{1,40}$/i.test(normalized)) {
    throw new Error("快捷键格式不安全。");
  }
  const parts = normalized.toLowerCase().split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) throw new Error("缺少快捷键。");
  const modifiers = parts
    .map((part) => {
      if (part === "cmd" || part === "command") return "command down";
      if (part === "ctrl" || part === "control") return "control down";
      if (part === "alt" || part === "option") return "option down";
      if (part === "shift") return "shift down";
      return "";
    })
    .filter(Boolean);
  const script = modifiers.length
    ? `tell application "System Events" to keystroke "${key}" using {${modifiers.join(", ")}}`
    : `tell application "System Events" to keystroke "${key}"`;
  await execFileAsync("osascript", ["-e", script], { timeout: 5000 });
  return { shortcut: normalized };
}

export function listMyComputerOperations(ownerId?: string) {
  return ownerId
    ? operationList().filter((operation) => !operation.ownerId || operation.ownerId === ownerId)
    : operationList();
}
