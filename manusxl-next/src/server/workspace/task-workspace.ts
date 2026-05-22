import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_WORKSPACE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

export class WorkspaceQuotaError extends Error {
  readonly kind = "disk_limit";

  constructor(
    readonly usageBytes: number,
    readonly limitBytes: number
  ) {
    super(
      `任务 workspace 已超过磁盘配额：当前 ${formatBytes(usageBytes)}，上限 ${formatBytes(limitBytes)}。`
    );
    this.name = "WorkspaceQuotaError";
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MB`;
  return `${(mib / 1024).toFixed(2)} GB`;
}

export function workspaceQuotaBytes() {
  const explicitBytes = Number(process.env.MANUSXL_WORKSPACE_QUOTA_BYTES);
  if (Number.isFinite(explicitBytes) && explicitBytes > 0) return Math.floor(explicitBytes);

  const explicitMb = Number(process.env.MANUSXL_WORKSPACE_QUOTA_MB);
  if (Number.isFinite(explicitMb) && explicitMb > 0) return Math.floor(explicitMb * 1024 * 1024);

  return DEFAULT_WORKSPACE_QUOTA_BYTES;
}

export async function getWorkspaceUsageBytes(root: string): Promise<number> {
  if (!existsSync(root)) return 0;
  const stats = await lstat(root);
  if (stats.isFile() || stats.isSymbolicLink()) return stats.size;
  if (!stats.isDirectory()) return 0;

  const entries = await readdir(root, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return getWorkspaceUsageBytes(path);
      const entryStats = await lstat(path);
      return entryStats.size;
    })
  );
  return sizes.reduce((total, size) => total + size, 0);
}

export async function assertWorkspaceQuota(root: string, limitBytes = workspaceQuotaBytes()) {
  const usageBytes = await getWorkspaceUsageBytes(root);
  if (Number.isFinite(limitBytes) && limitBytes > 0 && usageBytes > limitBytes) {
    throw new WorkspaceQuotaError(usageBytes, limitBytes);
  }
  return { usageBytes, limitBytes };
}

export function taskWorkspacePaths(taskId: string, ownerId?: string) {
  const root = ownerId
    ? `.manusxl-data/workspaces/${ownerId}/${taskId}`
    : `.manusxl-data/workspaces/${taskId}`;
  return {
    root,
    artifacts: `${root}/artifacts`,
    tmp: `${root}/tmp`,
    tmpArchived: `${root}/tmp_archived`,
    memory: `${root}/memory`,
    memoryFile: `${root}/memory/agent-memory.md`
  };
}

export async function ensureTaskWorkspace(taskId: string, ownerId?: string) {
  const paths = taskWorkspacePaths(taskId, ownerId);
  await mkdir(paths.artifacts, { recursive: true });
  await mkdir(paths.tmp, { recursive: true });
  await mkdir(paths.memory, { recursive: true });
  return paths;
}

function tmpRetentionDays() {
  const raw = process.env.MANUSXL_TMP_RETENTION_DAYS ?? process.env.RETENTION_DAYS;
  if (raw === undefined || raw.trim() === "") return 7;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 7;
}

export async function archiveTmpIfNeeded(taskId: string, ownerId?: string) {
  const paths = await ensureTaskWorkspace(taskId, ownerId);
  const retentionDays = tmpRetentionDays();
  const tmpFiles = existsSync(paths.tmp) ? await readdir(paths.tmp) : [];

  if (tmpFiles.length === 0) {
    return {
      retentionDays,
      action: "noop" as const,
      archivedPath: null,
      fileCount: 0
    };
  }

  if (retentionDays > 0) {
    return {
      retentionDays,
      action: "kept" as const,
      archivedPath: null,
      fileCount: tmpFiles.length
    };
  }

  await mkdir(paths.tmpArchived, { recursive: true });
  const archivedPath = `${paths.tmpArchived}/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await rename(paths.tmp, archivedPath);
  await mkdir(paths.tmp, { recursive: true });

  return {
    retentionDays,
    action: "archived" as const,
    archivedPath,
    fileCount: tmpFiles.length
  };
}

export async function pruneArchivedTmp(tmpArchived: string, retentionDays = tmpRetentionDays()) {
  if (!existsSync(tmpArchived) || retentionDays > 0) return;
  const entries = await readdir(tmpArchived);
  await Promise.all(entries.map((entry) => rm(`${tmpArchived}/${entry}`, { recursive: true, force: true })));
}
