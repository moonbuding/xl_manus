import { inflateRawSync } from "node:zlib";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataPath } from "@/server/data-root";
import { getManusDb } from "@/server/sqlite";
import type { AgentSkill } from "@/types/agent";

const sharedSkillsRoot = dataPath("skills", "shared");
const maxSkillZipBytes = 2 * 1024 * 1024;
const maxSkillEntryBytes = 512 * 1024;
const allowedSkillTools = new Set([
  "task_planner",
  "web_research",
  "web_fetch",
  "file_reader",
  "file_workspace",
  "batch_file_ops",
  "batch_image_process",
  "image_ocr",
  "skill_runner",
  "python_execute",
  "shell_execute",
  "data_analysis",
  "map_planner",
  "chart_generator",
  "artifact_writer"
]);
const allowedSkillExtensions = new Set([
  ".md",
  ".txt",
  ".json",
  ".csv",
  ".py",
  ".js",
  ".ts",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif"
]);

const builtinSkills: AgentSkill[] = [
  {
    id: "builtin-pdf",
    name: "pdf",
    description: "处理 PDF 上传、正文抽取、可读性判断和报告摘要。",
    triggers: ["pdf", "简历", "论文", "合同", "扫描", "报告"],
    toolsRequired: ["file_reader", "artifact_writer"],
    source: "builtin",
    enabled: true
  },
  {
    id: "builtin-spreadsheet",
    name: "spreadsheets",
    description: "处理 CSV/XLSX 数据预览、表格分析和 Excel 交付物。",
    triggers: ["excel", "xlsx", "csv", "表格", "数据"],
    toolsRequired: ["file_reader", "data_analysis", "artifact_writer"],
    source: "builtin",
    enabled: true
  },
  {
    id: "builtin-batch-files",
    name: "batch-files",
    description: "为图片、文档和表格生成批量重命名、分类、移动 dry-run 清单。",
    triggers: ["批量", "重命名", "分类", "图片", "文件整理"],
    toolsRequired: ["batch_file_ops", "file_workspace"],
    source: "builtin",
    enabled: true
  },
  {
    id: "builtin-image-tools",
    name: "image-tools",
    description: "处理上传图片的压缩、缩放、格式转换和 OCR 文字识别。",
    triggers: ["图片", "照片", "压缩", "缩放", "OCR", "文字识别", "发票", "名片"],
    toolsRequired: ["batch_image_process", "image_ocr", "file_reader"],
    source: "builtin",
    enabled: true
  },
  {
    id: "builtin-maps",
    name: "maps",
    description: "生成地点顺序、路线段、OpenStreetMap 链接和可下载地图式 HTML/JSON 交付物。",
    triggers: ["地图", "路线", "行程", "旅行", "旅游", "地址", "附近", "周边", "map", "route"],
    toolsRequired: ["map_planner", "web_research", "artifact_writer"],
    source: "builtin",
    enabled: true
  }
];

const executableSkillScripts = ["main.py", "run.py", "skill.py", "handler.py"];

function openSkillsDb() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_settings (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      skill_id TEXT,
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureSkillSchema(db);
  return db;
}

function getDb() {
  const db = openSkillsDb();
  ensureSkillSchema(db);
  return db;
}

function ensureSkillSchema(db: DatabaseSync) {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(skill_settings)").all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );
  if (!columns.has("owner_id")) db.exec("ALTER TABLE skill_settings ADD COLUMN owner_id TEXT");
  if (!columns.has("skill_id")) db.exec("ALTER TABLE skill_settings ADD COLUMN skill_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_skill_settings_owner_id ON skill_settings(owner_id)");
}

function localSkillsRoot(ownerId?: string) {
  return ownerId ? dataPath("skills", ownerId) : sharedSkillsRoot;
}

function settingId(skillId: string, ownerId?: string) {
  return ownerId ? `${ownerId}:${skillId}` : skillId;
}

function readSkillSetting(db: DatabaseSync, id: string, ownerId?: string) {
  const row = db.prepare("SELECT enabled FROM skill_settings WHERE id = ?").get(settingId(id, ownerId)) as
    | { enabled: number }
    | undefined;
  return row?.enabled;
}

function applyEnabledSettings(skills: AgentSkill[], ownerId?: string) {
  const db = getDb();
  return skills.map((skill) => {
    const enabled = readSkillSetting(db, skill.id, ownerId);
    return {
      ...skill,
      ownerId: skill.ownerId ?? ownerId,
      enabled: enabled === undefined ? skill.enabled : enabled === 1
    };
  });
}

function parseList(value: string | undefined) {
  if (!value) return [];
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateSkill(skill: AgentSkill): AgentSkill {
  const unknownTools = skill.toolsRequired.filter((tool) => !allowedSkillTools.has(tool));
  if (unknownTools.length === 0) {
    return {
      ...skill,
      validationStatus: "allowed",
      validationWarnings: []
    };
  }

  return {
    ...skill,
    enabled: false,
    validationStatus: "blocked",
    validationWarnings: [`未授权工具：${unknownTools.join("、")}。请先加入 allowlist 后再启用。`]
  };
}

function parseSkillMarkdown(id: string, markdown: string): AgentSkill {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);
  const meta = new Map<string, string>();

  for (const line of frontmatter?.[1].split("\n") ?? []) {
    const match = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.+)$/);
    if (match) meta.set(match[1], match[2].replace(/^["']|["']$/g, "").trim());
  }

  const name = meta.get("name") || id;
  const description =
    meta.get("description") ||
    markdown
      .replace(/^---[\s\S]*?---/, "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ||
    "本地 Skill";

  return {
    id: `local-${id}`,
    name,
    description,
    triggers: parseList(meta.get("triggers") || meta.get("trigger")),
    toolsRequired: parseList(meta.get("tools_required") || meta.get("tools")),
    source: "local",
    enabled: true
  };
}

function listLocalSkills(ownerId?: string) {
  const root = localSkillsRoot(ownerId);
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const skillPath = join(root, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) return [];
      return [{ ...parseSkillMarkdown(entry.name, readFileSync(skillPath, "utf8")), ownerId }];
    });
}

export function listSkills(ownerId?: string) {
  return applyEnabledSettings([...builtinSkills, ...listLocalSkills(ownerId)], ownerId).map(validateSkill);
}

export function updateSkillEnabled(skillId: string, enabled: boolean, ownerId?: string) {
  const db = getDb();
  db.prepare(`
    INSERT INTO skill_settings (id, owner_id, skill_id, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      owner_id = excluded.owner_id,
      skill_id = excluded.skill_id,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(settingId(skillId, ownerId), ownerId ?? null, skillId, enabled ? 1 : 0, new Date().toISOString());
  return listSkills(ownerId);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return index;
  }
  return -1;
}

function sanitizeSkillId(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "custom-skill"
  );
}

function safeZipEntryName(name: string) {
  const normalized = posix.normalize(name.replaceAll("\\", "/")).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.includes("../")) {
    throw new Error(`非法文件路径：${name}`);
  }
  return normalized;
}

function extractZipEntries(buffer: Buffer) {
  if (buffer.length > maxSkillZipBytes) {
    throw new Error("Skill 包超过 2MB 限制");
  }

  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new Error("没有找到有效的 ZIP 目录");

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: Array<{ name: string; data: Buffer }> = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP 中央目录损坏");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const name = safeZipEntryName(rawName);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if ((flags & 1) === 1) throw new Error(`${name} 是加密文件，不能导入`);
    if (uncompressedSize > maxSkillEntryBytes) throw new Error(`${name} 超过单文件大小限制`);
    if (!allowedSkillExtensions.has(extname(name).toLowerCase())) {
      throw new Error(`${name} 不是允许的 Skill 文件类型`);
    }
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`${name} 的本地文件头损坏`);
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : undefined;
    if (!data) throw new Error(`${name} 使用了不支持的压缩方式`);
    entries.push({ name, data });
  }

  return entries;
}

export function installSkillZip(input: { filename: string; buffer: Buffer }, ownerId?: string) {
  const entries = extractZipEntries(input.buffer);
  const skillEntry = entries.find((entry) => entry.name.split("/").at(-1) === "SKILL.md");
  if (!skillEntry) throw new Error("Skill 包必须包含 SKILL.md");

  const parsed = parseSkillMarkdown(sanitizeSkillId(input.filename.replace(/\.zip$/i, "")), skillEntry.data.toString("utf8"));
  const firstFolder = skillEntry.name.includes("/") ? skillEntry.name.split("/")[0] : parsed.name;
  const skillId = sanitizeSkillId(parsed.name || firstFolder);
  const targetRoot = join(localSkillsRoot(ownerId), skillId);
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });

  for (const entry of entries) {
    const relativeName = entry.name.startsWith(`${firstFolder}/`)
      ? entry.name.slice(firstFolder.length + 1)
      : entry.name;
    const safeName = safeZipEntryName(relativeName);
    const target = join(targetRoot, safeName);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
  }

  const skill = validateSkill({
    ...parseSkillMarkdown(skillId, readFileSync(join(targetRoot, "SKILL.md"), "utf8")),
    ownerId
  });
  return {
    skill,
    skills: listSkills(ownerId)
  };
}

export function selectSkillsForPrompt(prompt: string, ownerId?: string) {
  const normalized = prompt.toLowerCase();
  return listSkills(ownerId)
    .filter((skill) => skill.enabled && skill.validationStatus !== "blocked")
    .map((skill) => {
      const matched =
        skill.triggers.length === 0
          ? normalized.includes(skill.name.toLowerCase())
          : skill.triggers.some((trigger) => normalized.includes(trigger.toLowerCase()));
      return { ...skill, matched };
    })
    .filter((skill) => skill.matched)
    .slice(0, 5);
}

function findExecutableSkillScript(skillRoot: string) {
  return executableSkillScripts.find((filename) => existsSync(join(skillRoot, filename)));
}

export interface ExecutableSkill extends AgentSkill {
  rootPath: string;
  scriptName: string;
}

export function selectExecutableSkillsForPrompt(prompt: string, ownerId?: string): ExecutableSkill[] {
  const matchedSkills = selectSkillsForPrompt(prompt, ownerId).filter((skill) => skill.source === "local");
  const root = localSkillsRoot(ownerId);

  return matchedSkills.flatMap((skill) => {
    const skillFolder = skill.id.replace(/^local-/, "");
    const rootPath = join(root, skillFolder);
    const scriptName = findExecutableSkillScript(rootPath);
    if (!scriptName) return [];

    return [
      {
        ...skill,
        rootPath,
        scriptName
      }
    ];
  });
}

export function hasExecutableSkillForPrompt(prompt: string, ownerId?: string) {
  return selectExecutableSkillsForPrompt(prompt, ownerId).length > 0;
}
