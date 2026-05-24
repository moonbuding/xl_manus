import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

export interface DesktopTaskArtifact {
  name: string;
  type: "txt" | "md" | "json";
  mimeType: string;
  content: string;
}

export interface DesktopLocalTaskResult {
  finalAnswer: string;
  artifacts: DesktopTaskArtifact[];
}

interface LocalFileEntry {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: string;
}

interface DesktopMoveAction {
  from: string;
  to: string;
  relativeFrom: string;
  relativeTo: string;
}

interface DesktopUndoLog {
  id: string;
  operation: "classify";
  root: string;
  createdAt: string;
  actions: DesktopMoveAction[];
}

const maxEntries = 220;
const maxMoveActions = 120;
const maxHashFileSize = 8 * 1024 * 1024;
const organizedFolderName = "ManusXL Organized";
const undoFileName = ".manusxl-desktop-undo.json";

function normalizeRoot(root: string) {
  return resolve(root.trim());
}

function isPathInside(root: string, candidate: string) {
  const normalizedRoot = normalizeRoot(root);
  const normalizedCandidate = resolve(candidate);
  const diff = relative(normalizedRoot, normalizedCandidate);
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}

function pickRoot(prompt: string, allowedRoots: string[]) {
  const roots = allowedRoots.map(normalizeRoot).filter(Boolean);
  const absoluteHints = prompt.match(/(?:\/[^\s，。；;]+)/g) ?? [];
  const hinted = absoluteHints
    .map((hint) => hint.replace(/[）),.。；;]+$/, ""))
    .find((hint) => roots.some((root) => isPathInside(root, hint)));
  return hinted ? normalizeRoot(hinted) : roots[0];
}

async function walkFiles(root: string, depth = 2) {
  const entries: LocalFileEntry[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];

  while (queue.length > 0 && entries.length < maxEntries) {
    const current = queue.shift();
    if (!current) break;
    const children = await readdir(current.path, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (entries.length >= maxEntries) break;
      const path = join(current.path, child.name);
      if (!isPathInside(root, path)) continue;
      const info = await stat(path).catch(() => undefined);
      if (!info) continue;
      if (child.isDirectory()) {
        if (current.depth < depth) queue.push({ path, depth: current.depth + 1 });
        continue;
      }
      if (!child.isFile()) continue;
      if (child.name === undoFileName) continue;
      entries.push({
        path,
        relativePath: relative(root, path) || child.name,
        name: child.name,
        extension: extname(child.name).toLowerCase() || "(no extension)",
        size: info.size,
        modifiedAt: info.mtime.toISOString()
      });
    }
  }

  return entries;
}

async function exists(path: string) {
  return Boolean(await stat(path).catch(() => undefined));
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function scanReport(root: string, entries: LocalFileEntry[]) {
  const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
  const byExtension = new Map<string, { count: number; size: number }>();
  entries.forEach((entry) => {
    const current = byExtension.get(entry.extension) ?? { count: 0, size: 0 };
    current.count += 1;
    current.size += entry.size;
    byExtension.set(entry.extension, current);
  });
  const extensionRows = [...byExtension.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([extension, value]) => `- ${extension}: ${value.count} files, ${formatSize(value.size)}`);
  const recentRows = [...entries]
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 20)
    .map((entry) => `- ${entry.relativePath} (${formatSize(entry.size)})`);

  return [
    "# Desktop File Scan",
    "",
    `Root: ${root}`,
    `Files scanned: ${entries.length}${entries.length >= maxEntries ? " (truncated)" : ""}`,
    `Total size: ${formatSize(totalSize)}`,
    "",
    "## By extension",
    extensionRows.length ? extensionRows.join("\n") : "- No files found.",
    "",
    "## Recent files",
    recentRows.length ? recentRows.join("\n") : "- No files found."
  ].join("\n");
}

function classifyGroup(extension: string) {
  return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"].includes(extension)
    ? "Images"
    : [".pdf", ".doc", ".docx", ".md", ".txt"].includes(extension)
      ? "Documents"
      : [".csv", ".tsv", ".xls", ".xlsx", ".numbers"].includes(extension)
        ? "Sheets"
        : [".zip", ".rar", ".7z", ".tar", ".gz"].includes(extension)
          ? "Archives"
          : [".mp4", ".mov", ".mp3", ".wav", ".m4a"].includes(extension)
            ? "Media"
            : "Other";
}

function classificationEntries(entries: LocalFileEntry[]) {
  return entries.filter((entry) => !entry.relativePath.startsWith(`${organizedFolderName}/`));
}

function classifyReport(root: string, entries: LocalFileEntry[]) {
  const groups = new Map<string, LocalFileEntry[]>();
  classificationEntries(entries).forEach((entry) => {
    const key = classifyGroup(entry.extension);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  });
  const groupRows = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([group, files]) => {
      const examples = files
        .slice(0, 8)
        .map((file) => `  - ${file.relativePath} -> ${organizedFolderName}/${group}/${file.name}`)
        .join("\n");
      return [`- ${group}: ${files.length} files`, examples].filter(Boolean).join("\n");
    });

  return [
    "# Desktop Classification Preview",
    "",
    `Root: ${root}`,
    "Mode: dry-run only. No files were moved.",
    "",
    groupRows.length ? groupRows.join("\n") : "- No files found."
  ].join("\n");
}

async function uniqueDestination(path: string) {
  if (!(await exists(path))) return path;
  const extension = extname(path);
  const stem = extension ? path.slice(0, -extension.length) : path;
  for (let index = 1; index <= 999; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Cannot find available destination for ${path}`);
}

async function executeClassification(root: string, entries: LocalFileEntry[]) {
  const actions: DesktopMoveAction[] = [];
  const skipped: string[] = [];
  const candidates = classificationEntries(entries).slice(0, maxMoveActions);

  for (const entry of candidates) {
    const group = classifyGroup(entry.extension);
    const destinationFolder = join(root, organizedFolderName, group);
    const destination = await uniqueDestination(join(destinationFolder, entry.name));
    if (!isPathInside(root, destination)) {
      skipped.push(entry.relativePath);
      continue;
    }
    await mkdir(destinationFolder, { recursive: true });
    await rename(entry.path, destination);
    actions.push({
      from: entry.path,
      to: destination,
      relativeFrom: entry.relativePath,
      relativeTo: relative(root, destination)
    });
  }

  const undoLog: DesktopUndoLog = {
    id: `desktop-undo-${Date.now()}`,
    operation: "classify",
    root,
    createdAt: new Date().toISOString(),
    actions
  };
  if (actions.length > 0) {
    await writeFile(join(root, undoFileName), JSON.stringify(undoLog, null, 2), "utf8");
  }

  const rows = [
    "# Desktop Classification Execution",
    "",
    `Root: ${root}`,
    `Moved files: ${actions.length}`,
    `Skipped files: ${skipped.length}`,
    actions.length >= maxMoveActions ? `Move limit reached: ${maxMoveActions}` : "",
    "",
    "## Moves",
    actions.length
      ? actions.map((action) => `- ${action.relativeFrom} -> ${action.relativeTo}`).join("\n")
      : "- No files were moved.",
    "",
    "## Skipped",
    skipped.length ? skipped.map((item) => `- ${item}`).join("\n") : "- None"
  ].filter(Boolean);

  return {
    report: rows.join("\n"),
    actions
  };
}

async function undoLastDesktopOperation(root: string) {
  const undoPath = join(root, undoFileName);
  const raw = await readFile(undoPath, "utf8").catch(() => undefined);
  if (!raw) {
    return {
      report: [
        "# Desktop Undo",
        "",
        `Root: ${root}`,
        "No desktop undo log was found."
      ].join("\n"),
      restored: 0
    };
  }
  const log = JSON.parse(raw) as DesktopUndoLog;
  const restored: DesktopMoveAction[] = [];
  const skipped: string[] = [];

  for (const action of [...log.actions].reverse()) {
    if (!isPathInside(root, action.from) || !isPathInside(root, action.to)) {
      skipped.push(action.relativeTo);
      continue;
    }
    if (await exists(action.from)) {
      skipped.push(`${action.relativeTo} (original path already exists)`);
      continue;
    }
    if (!(await exists(action.to))) {
      skipped.push(`${action.relativeTo} (moved file missing)`);
      continue;
    }
    await mkdir(dirname(action.from), { recursive: true });
    await rename(action.to, action.from);
    restored.push(action);
  }

  const rows = [
    "# Desktop Undo",
    "",
    `Root: ${root}`,
    `Restored files: ${restored.length}`,
    `Skipped files: ${skipped.length}`,
    "",
    "## Restored",
    restored.length
      ? restored.map((action) => `- ${action.relativeTo} -> ${action.relativeFrom}`).join("\n")
      : "- No files were restored.",
    "",
    "## Skipped",
    skipped.length ? skipped.map((item) => `- ${item}`).join("\n") : "- None"
  ];

  return {
    report: rows.join("\n"),
    restored: restored.length
  };
}

async function duplicateReport(root: string, entries: LocalFileEntry[]) {
  const hashGroups = new Map<string, LocalFileEntry[]>();
  for (const entry of entries.filter((item) => item.size > 0 && item.size <= maxHashFileSize)) {
    const content = await readFile(entry.path).catch(() => undefined);
    if (!content) continue;
    const hash = createHash("sha256").update(content).digest("hex");
    hashGroups.set(hash, [...(hashGroups.get(hash) ?? []), entry]);
  }
  const duplicates = [...hashGroups.values()].filter((group) => group.length > 1);
  const rows = duplicates.slice(0, 20).map((group, index) => {
    const examples = group.map((file) => `  - ${file.relativePath} (${formatSize(file.size)})`).join("\n");
    return [`${index + 1}. ${group.length} duplicates`, examples].join("\n");
  });

  return [
    "# Desktop Duplicate Preview",
    "",
    `Root: ${root}`,
    `Files hashed: ${[...hashGroups.values()].reduce((sum, group) => sum + group.length, 0)}`,
    "Mode: dry-run only. No files were deleted or moved.",
    "",
    rows.length ? rows.join("\n\n") : "No duplicate file content found in the scanned set."
  ].join("\n");
}

export async function runDesktopLocalTask(prompt: string, allowedRoots: string[]): Promise<DesktopLocalTaskResult> {
  const root = pickRoot(prompt, allowedRoots);
  if (!root) {
    const finalAnswer = "My Computer 桌面端已接收任务，但当前没有可用的允许目录。请先在 Web Settings / My Computer 配置 allowed roots。";
    return {
      finalAnswer,
      artifacts: [
        {
          name: "desktop-local-report.md",
          type: "md",
          mimeType: "text/markdown",
          content: `# Desktop Local Report\n\n${finalAnswer}\n`
        }
      ]
    };
  }

  const entries = await walkFiles(root);
  const normalizedPrompt = prompt.toLowerCase();
  const wantsDuplicates = /查重|重复|duplicate|dedupe/.test(normalizedPrompt);
  const wantsClassify = /分类|整理|classify|organize/.test(normalizedPrompt);
  const wantsUndo = /撤销|恢复上次|undo/.test(normalizedPrompt);
  const wantsExecution = /确认执行|执行分类|执行整理|apply|execute|move files|organize now/.test(normalizedPrompt);
  const execution = wantsClassify && wantsExecution ? await executeClassification(root, entries) : undefined;
  const undo = wantsUndo ? await undoLastDesktopOperation(root) : undefined;
  const report = undo
    ? undo.report
    : execution
      ? execution.report
      : wantsDuplicates
        ? await duplicateReport(root, entries)
        : wantsClassify
          ? classifyReport(root, entries)
          : scanReport(root, entries);
  const mode = undo
    ? "撤销操作"
    : execution
      ? "真实分类整理"
      : wantsDuplicates
        ? "查重预览"
        : wantsClassify
          ? "分类预览"
          : "目录扫描";
  const finalAnswer = [
    `ManusXL Desktop 已在本机完成 ${mode}：${basename(root) || root}`,
    "",
    execution
      ? `已移动文件数：${execution.actions.length}`
      : undo
        ? `已恢复文件数：${undo.restored}`
        : `扫描文件数：${entries.length}${entries.length >= maxEntries ? "（已截断）" : ""}`,
    execution || undo
      ? "操作限制在 My Computer allowed roots 内，并已生成审计用结果报告。"
      : "本阶段仅执行只读 dry-run，不会移动、重命名或删除文件。",
    "",
    "详细结果已写入 desktop-local-report.md。"
  ].join("\n");

  return {
    finalAnswer,
    artifacts: [
      {
        name: "desktop-local-report.md",
        type: "md",
        mimeType: "text/markdown",
        content: report
      },
      {
        name: "desktop-local-files.json",
        type: "json",
        mimeType: "application/json",
        content: JSON.stringify({ root, files: entries }, null, 2)
      }
    ]
  };
}
