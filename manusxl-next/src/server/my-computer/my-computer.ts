import { createHash } from "node:crypto";
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
import type {
  MyComputerApprovalDecision,
  MyComputerFileAction,
  MyComputerFileEntry,
  MyComputerFilePlanMode,
  MyComputerFilePlanResponse,
  MyComputerFileScanResponse,
  MyComputerOperation,
  MyComputerOperationKind,
  MyComputerStatus
} from "@/types/agent";

const execFileAsync = promisify(execFile);
const maxRecentOperations = 80;
const maxFileHashBytes = 50 * 1024 * 1024;
const undoableFileKinds = new Set<MyComputerOperationKind>([
  "file_classify",
  "file_dedupe",
  "file_rename",
  "file_move"
]);

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

function persistAlwaysAllowRules() {
  updateAppConfig({
    myComputerAlwaysAllowRules: Array.from(alwaysAllowSet()).slice(0, 100)
  });
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
  return {
    connected: true,
    bridge: "next-local",
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
      }
    ],
    recentOperations: operations.slice(0, 20),
    pendingApprovals: operations.filter((operation) => operation.status === "pending_approval").slice(0, 20)
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
    "app_launch" | "clipboard_write" | "keyboard_shortcut" | "mouse_click" | "terminal_command"
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
    throw new Error("本机 terminal 执行默认关闭；请先接入命令 allowlist 后启用。");
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
