import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { hostname, platform } from "node:os";
import { basename, dirname, extname } from "node:path";
import { runDesktopLocalTask } from "./local-tools";
import { runDesktopSystemTask } from "./system-tools";
import type {
  DesktopCloudUploadResult,
  DesktopDeviceConfig,
  DesktopFileRequest,
  DesktopRuntimeStatus,
  DesktopTaskAssignment,
  DesktopTaskClaimResponse,
  HeartbeatResponse,
  MyComputerOperationKind,
  PairingVerifyResponse
} from "./types";

export const desktopCapabilities: MyComputerOperationKind[] = [
  "file_scan",
  "file_classify",
  "file_dedupe",
  "file_rename",
  "file_undo",
  "app_launch",
  "app_quit",
  "clipboard_write",
  "clipboard_read",
  "keyboard_shortcut",
  "mouse_click",
  "terminal_command"
];

export class DesktopAgentClient {
  private config?: DesktopDeviceConfig;
  private lastHeartbeat?: HeartbeatResponse;
  private currentTask?: DesktopTaskAssignment;
  private lastTask?: DesktopTaskAssignment;
  private lastUpload?: DesktopCloudUploadResult;
  private lastError?: string;

  constructor(
    private readonly configPath: string,
    private readonly defaultServerUrl = "http://localhost:3000"
  ) {}

  async load() {
    if (this.config) return this.config;
    try {
      const raw = await readFile(this.configPath, "utf8");
      this.config = JSON.parse(raw) as DesktopDeviceConfig;
    } catch {
      this.config = {
        serverUrl: this.defaultServerUrl,
        deviceName: `ManusXL Desktop ${hostname()}`
      };
    }
    return this.config;
  }

  async save(next: DesktopDeviceConfig) {
    this.config = next;
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify(next, null, 2), "utf8");
  }

  async updateServerUrl(serverUrl: string) {
    const config = await this.load();
    const normalized = serverUrl.trim().replace(/\/+$/, "") || this.defaultServerUrl;
    await this.save({ ...config, serverUrl: normalized });
    return this.status();
  }

  async pair(code: string, deviceName?: string) {
    const config = await this.load();
    const name = (deviceName || config.deviceName || `ManusXL Desktop ${hostname()}`).trim();
    const response = await this.post<PairingVerifyResponse>("/api/my-computer/desktop/pairing/verify", {
      code,
      deviceName: name,
      bridge: "electron",
      platform: platform(),
      appVersion: "0.1.0",
      capabilities: desktopCapabilities,
      metadata: {
        host: hostname()
      }
    });
    if (!response.paired || !response.token || !response.device) {
      throw new Error(response.error ?? "Desktop pairing failed.");
    }
    await this.save({
      ...config,
      token: response.token,
      deviceId: response.device.id,
      deviceName: response.device.name
    });
    this.lastError = undefined;
    return response;
  }

  async heartbeat() {
    const config = await this.load();
    if (!config.token) {
      this.lastHeartbeat = undefined;
      this.lastError = "Desktop is not paired yet.";
      return undefined;
    }
    try {
      const response = await this.post<HeartbeatResponse>(
        "/api/my-computer/desktop/heartbeat",
        {
          capabilities: desktopCapabilities,
          appVersion: "0.1.0",
          platform: platform(),
          metadata: {
            host: hostname()
          }
        },
        config.token
      );
      if (!response.ok) throw new Error(response.error ?? "Heartbeat failed.");
      this.lastHeartbeat = response;
      this.lastError = undefined;
      await this.runNextAssignedTask();
      return response;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async status(): Promise<DesktopRuntimeStatus> {
    const config = await this.load();
    return {
      configured: Boolean(config.token),
      serverUrl: config.serverUrl,
      deviceName: config.deviceName,
      lastHeartbeat: this.lastHeartbeat,
      currentTask: this.currentTask,
      lastTask: this.lastTask,
      lastUpload: this.lastUpload,
      pendingFileRequests: this.lastHeartbeat?.fileRequests ?? [],
      lastFileRequest: this.lastFileRequest,
      lastError: this.lastError
    };
  }

  private lastFileRequest?: DesktopFileRequest;

  async uploadLocalFile(filePath: string) {
    const uploaded = await this.uploadLocalFileToCloud(filePath);
    this.lastUpload = uploaded;
    return this.status();
  }

  async approveFileRequest(requestId: string) {
    const config = await this.load();
    if (!config.token) throw new Error("Desktop is not paired yet.");
    const fileRequest = this.lastHeartbeat?.fileRequests?.find((request) => request.id === requestId);
    if (!fileRequest) throw new Error("File request is not pending on this desktop.");
    try {
      const uploaded = await this.uploadLocalFileToCloud(fileRequest.requestedPath);
      if (!uploaded.ok || !uploaded.file?.id) {
        throw new Error(uploaded.error ?? "Desktop file upload did not return a file id.");
      }
      this.lastUpload = uploaded;
      const decided = await this.post<{
        ok: boolean;
        request?: DesktopFileRequest;
        error?: string;
      }>(
        `/api/my-computer/desktop/file-requests/${encodeURIComponent(requestId)}/decision`,
        {
          decision: "approve",
          uploadedFileId: uploaded.file.id
        },
        config.token
      );
      if (!decided.ok || !decided.request) throw new Error(decided.error ?? "File request approval failed.");
      this.lastFileRequest = decided.request;
      if (this.lastHeartbeat) {
        this.lastHeartbeat.fileRequests = this.lastHeartbeat.fileRequests?.filter((request) => request.id !== requestId);
      }
      this.lastError = undefined;
      return this.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      try {
        await this.post(
          `/api/my-computer/desktop/file-requests/${encodeURIComponent(requestId)}/decision`,
          {
            decision: "approve",
            error: message
          },
          config.token
        );
      } catch {
        // Keep the original upload error visible to the desktop UI.
      }
      throw error;
    }
  }

  async denyFileRequest(requestId: string) {
    const config = await this.load();
    if (!config.token) throw new Error("Desktop is not paired yet.");
    const decided = await this.post<{
      ok: boolean;
      request?: DesktopFileRequest;
      error?: string;
    }>(
      `/api/my-computer/desktop/file-requests/${encodeURIComponent(requestId)}/decision`,
      {
        decision: "deny"
      },
      config.token
    );
    if (!decided.ok || !decided.request) throw new Error(decided.error ?? "File request denial failed.");
    this.lastFileRequest = decided.request;
    if (this.lastHeartbeat) {
      this.lastHeartbeat.fileRequests = this.lastHeartbeat.fileRequests?.filter((request) => request.id !== requestId);
    }
    this.lastError = undefined;
    return this.status();
  }

  private async uploadLocalFileToCloud(filePath: string) {
    const config = await this.load();
    if (!config.token) throw new Error("Desktop is not paired yet.");
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Only regular files can be uploaded.");
    const buffer = await readFile(filePath);
    return this.post<DesktopCloudUploadResult>(
      "/api/my-computer/desktop/files/upload",
      {
        name: basename(filePath),
        mimeType: mimeTypeFromExtension(filePath),
        contentBase64: buffer.toString("base64"),
        sourcePath: filePath,
        expiresInDays: 7
      },
      config.token
    );
  }

  async cancelCurrentTask() {
    const config = await this.load();
    const task = this.currentTask;
    if (!config.token || !task) return this.status();
    const cancelled = await this.post<{
      ok: boolean;
      assignment?: DesktopTaskAssignment;
      error?: string;
    }>(
      `/api/my-computer/desktop/tasks/${encodeURIComponent(task.taskId)}/cancel`,
      {},
      config.token
    );
    if (!cancelled.ok) throw new Error(cancelled.error ?? "Desktop task cancellation failed.");
    this.currentTask = undefined;
    this.lastTask = cancelled.assignment;
    return this.status();
  }

  async runNextAssignedTask() {
    const config = await this.load();
    if (!config.token) return undefined;
    const claimed = await this.post<DesktopTaskClaimResponse>(
      "/api/my-computer/desktop/tasks/next",
      {},
      config.token
    );
    if (!claimed.ok || !claimed.assignment || !claimed.task) return undefined;

    this.currentTask = claimed.assignment;
    await this.post(
      `/api/my-computer/desktop/tasks/${encodeURIComponent(claimed.task.id)}/events`,
      {
        type: "thinking",
        title: "桌面端开始执行",
        content: `已在本机接收任务：${claimed.task.prompt}`
      },
      config.token
    );
    const execution =
      (await runDesktopSystemTask(claimed.task.prompt, this.lastHeartbeat?.allowedRoots ?? [])) ??
      (await runDesktopLocalTask(claimed.task.prompt, this.lastHeartbeat?.allowedRoots ?? []));
    await this.post(
      `/api/my-computer/desktop/tasks/${encodeURIComponent(claimed.task.id)}/events`,
      {
        type: "tool_result",
        title: "桌面端生成交付物",
        content: `已生成 ${execution.artifacts.length} 个本机执行交付物，准备回写 Web 时间线。`
      },
      config.token
    );
    const completed = await this.post<{
      ok: boolean;
      assignment?: DesktopTaskAssignment;
      error?: string;
    }>(
      `/api/my-computer/desktop/tasks/${encodeURIComponent(claimed.task.id)}/complete`,
      {
        ok: true,
        finalAnswer: execution.finalAnswer,
        artifacts: execution.artifacts
      },
      config.token
    );
    if (!completed.ok) throw new Error(completed.error ?? "Desktop task completion failed.");
    this.currentTask = undefined;
    this.lastTask = completed.assignment;
    return completed.assignment;
  }

  private async post<T>(pathname: string, body: unknown, token?: string): Promise<T> {
    const config = await this.load();
    const response = await fetch(new URL(pathname, config.serverUrl).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(parsed.error ?? `${pathname} failed with ${response.status}`);
    }
    return parsed as T;
  }
}

function mimeTypeFromExtension(path: string) {
  const extension = extname(path).toLowerCase();
  if (extension === ".txt" || extension === ".md" || extension === ".markdown") return "text/plain";
  if (extension === ".json") return "application/json";
  if (extension === ".csv") return "text/csv";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "application/octet-stream";
}
