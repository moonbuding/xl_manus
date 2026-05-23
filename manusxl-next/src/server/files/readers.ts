import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { inflateRawSync, inflateSync } from "node:zlib";
import { createId } from "@/lib/id";
import { dataPath } from "@/server/data-root";
import {
  canUsePostgresRuntime,
  checkPsqlCli,
  requestedDatabaseProvider,
  runPsql
} from "@/server/db/provider";
import { getManusDb } from "@/server/sqlite";
import type { UploadedFileSummary } from "@/types/agent";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT = 4200;
const PDF_EXTRACTION_LIMIT = 12000;
const execFileAsync = promisify(execFile);

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface UploadedFileRecord extends UploadedFileSummary {
  ownerId?: string;
  storedPath: string;
  createdAt: string;
}

interface UploadPersistenceAdapter {
  provider: "sqlite" | "postgres";
  ensureSchema: () => void;
  save: (record: UploadedFileRecord) => void;
  get: (fileId: string, ownerId?: string) => UploadedFileRecord | undefined;
  list: (ownerId: string, limit: number) => UploadedFileRecord[];
  delete: (fileId: string, ownerId?: string) => void;
}

const globalForUploads = globalThis as unknown as {
  manusxlUploadStore?: UploadPersistenceAdapter;
};

function getUploadDb() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS uploaded_files (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      extension TEXT NOT NULL,
      size INTEGER NOT NULL,
      stored_path TEXT NOT NULL,
      text_preview TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_uploaded_files_owner_id ON uploaded_files(owner_id);
    CREATE INDEX IF NOT EXISTS idx_uploaded_files_created_at ON uploaded_files(created_at);
  `);
  return db;
}

function saveUploadRecordSqlite(record: UploadedFileRecord) {
  getUploadDb()
    .prepare(
      `
        INSERT INTO uploaded_files
          (id, owner_id, name, mime_type, extension, size, stored_path, text_preview, summary, metadata_json, created_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          owner_id = excluded.owner_id,
          name = excluded.name,
          mime_type = excluded.mime_type,
          extension = excluded.extension,
          size = excluded.size,
          stored_path = excluded.stored_path,
          text_preview = excluded.text_preview,
          summary = excluded.summary,
          metadata_json = excluded.metadata_json,
          data_json = excluded.data_json
      `
    )
    .run(
      record.id,
      record.ownerId ?? null,
      record.name,
      record.mimeType,
      record.extension,
      record.size,
      record.storedPath,
      record.textPreview,
      record.summary,
      JSON.stringify(record.metadata),
      record.createdAt,
      JSON.stringify(record)
    );
}

function getUploadedFileRecordSqlite(fileId: string, ownerId?: string) {
  const db = getUploadDb();
  const normalizedId = fileId.trim();
  if (!normalizedId) return undefined;

  const row = ownerId
    ? (db
        .prepare("SELECT data_json FROM uploaded_files WHERE id = ? AND owner_id = ?")
        .get(normalizedId, ownerId) as { data_json: string } | undefined)
    : (db
        .prepare("SELECT data_json FROM uploaded_files WHERE id = ?")
        .get(normalizedId) as { data_json: string } | undefined);

  return row ? (JSON.parse(row.data_json) as UploadedFileRecord) : undefined;
}

function listUploadedFileRecordsSqlite(ownerId: string, limit: number) {
  const rows = getUploadDb()
    .prepare(
      `
        SELECT data_json
        FROM uploaded_files
        WHERE owner_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `
    )
    .all(ownerId, Math.max(1, Math.min(limit, 200))) as Array<{ data_json: string }>;
  return rows.map((row) => JSON.parse(row.data_json) as UploadedFileRecord);
}

function deleteUploadedFileRecordSqlite(fileId: string, ownerId?: string) {
  const db = getUploadDb();
  if (ownerId) {
    db.prepare("DELETE FROM uploaded_files WHERE id = ? AND owner_id = ?").run(fileId, ownerId);
    return;
  }
  db.prepare("DELETE FROM uploaded_files WHERE id = ?").run(fileId);
}

function postgresSchemaPath() {
  return join(process.cwd(), "db", "postgres", "0001_initial.sql");
}

function quotePostgresString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function postgresValue(value: unknown, options: { json?: boolean } = {}) {
  if (value === undefined || value === null) return "NULL";
  if (options.json) return `${quotePostgresString(JSON.stringify(value))}::jsonb`;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return quotePostgresString(String(value));
}

function ensurePostgresSchema() {
  const schemaPath = postgresSchemaPath();
  if (!existsSync(schemaPath)) {
    throw new Error(`找不到 PostgreSQL schema：${schemaPath}`);
  }
  runPsql(["-f", schemaPath]);
}

function uploadRecordUpsertSql(record: UploadedFileRecord) {
  return `
    INSERT INTO uploaded_files
      (id, owner_id, name, mime_type, extension, size, stored_path, text_preview, summary, metadata_json, created_at, data_json)
    VALUES (
      ${postgresValue(record.id)},
      ${postgresValue(record.ownerId)},
      ${postgresValue(record.name)},
      ${postgresValue(record.mimeType)},
      ${postgresValue(record.extension)},
      ${postgresValue(record.size)},
      ${postgresValue(record.storedPath)},
      ${postgresValue(record.textPreview)},
      ${postgresValue(record.summary)},
      ${postgresValue(record.metadata, { json: true })},
      ${postgresValue(record.createdAt)},
      ${postgresValue(record, { json: true })}
    )
    ON CONFLICT (id) DO UPDATE SET
      owner_id = EXCLUDED.owner_id,
      name = EXCLUDED.name,
      mime_type = EXCLUDED.mime_type,
      extension = EXCLUDED.extension,
      size = EXCLUDED.size,
      stored_path = EXCLUDED.stored_path,
      text_preview = EXCLUDED.text_preview,
      summary = EXCLUDED.summary,
      metadata_json = EXCLUDED.metadata_json,
      data_json = EXCLUDED.data_json;
  `;
}

function getUploadedFileRecordPostgres(fileId: string, ownerId?: string) {
  const normalizedId = fileId.trim();
  if (!normalizedId) return undefined;

  const ownerFilter = ownerId ? `AND owner_id = ${postgresValue(ownerId)}` : "";
  const output = runPsql([
    "-At",
    "-c",
    `
      SELECT data_json::text
      FROM uploaded_files
      WHERE id = ${postgresValue(normalizedId)}
      ${ownerFilter}
      LIMIT 1;
    `
  ]);
  const row = output.trim();
  return row ? (JSON.parse(row) as UploadedFileRecord) : undefined;
}

function listUploadedFileRecordsPostgres(ownerId: string, limit: number) {
  const output = runPsql([
    "-At",
    "-c",
    `
      SELECT data_json::text
      FROM uploaded_files
      WHERE owner_id = ${postgresValue(ownerId)}
      ORDER BY created_at DESC
      LIMIT ${Math.max(1, Math.min(limit, 200))};
    `
  ]);
  return output
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => JSON.parse(row) as UploadedFileRecord);
}

function deleteUploadedFileRecordPostgres(fileId: string, ownerId?: string) {
  const ownerFilter = ownerId ? `AND owner_id = ${postgresValue(ownerId)}` : "";
  runPsql([
    "-c",
    `
      DELETE FROM uploaded_files
      WHERE id = ${postgresValue(fileId)}
      ${ownerFilter};
    `
  ]);
}

function createSqliteUploadStore(): UploadPersistenceAdapter {
  return {
    provider: "sqlite",
    ensureSchema: () => {
      getUploadDb();
    },
    save: saveUploadRecordSqlite,
    get: getUploadedFileRecordSqlite,
    list: listUploadedFileRecordsSqlite,
    delete: deleteUploadedFileRecordSqlite
  };
}

function createPostgresUploadStore(): UploadPersistenceAdapter {
  ensurePostgresSchema();
  return {
    provider: "postgres",
    ensureSchema: ensurePostgresSchema,
    save: (record) => {
      runPsql(["-c", uploadRecordUpsertSql(record)]);
    },
    get: getUploadedFileRecordPostgres,
    list: listUploadedFileRecordsPostgres,
    delete: deleteUploadedFileRecordPostgres
  };
}

function createUploadStore(): UploadPersistenceAdapter {
  const requestedProvider = requestedDatabaseProvider();
  if (requestedProvider === "postgres") {
    const psql = checkPsqlCli();
    if (!canUsePostgresRuntime(psql)) {
      console.warn(
        "MANUSXL_DATABASE_PROVIDER=postgres 已设置，但 DATABASE_URL 或 psql CLI 不可用，上传文件索引回退 SQLite。"
      );
      return createSqliteUploadStore();
    }
    try {
      return createPostgresUploadStore();
    } catch (error) {
      console.warn(
        `PostgreSQL 上传文件索引初始化失败，已回退 SQLite：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return createSqliteUploadStore();
}

function getUploadStore() {
  if (
    !globalForUploads.manusxlUploadStore ||
    typeof globalForUploads.manusxlUploadStore.list !== "function" ||
    typeof globalForUploads.manusxlUploadStore.delete !== "function"
  ) {
    globalForUploads.manusxlUploadStore = createUploadStore();
  }
  globalForUploads.manusxlUploadStore.ensureSchema();
  return globalForUploads.manusxlUploadStore;
}

function saveUploadRecord(record: UploadedFileRecord) {
  getUploadStore().save(record);
}

export function getUploadedFileRecord(fileId: string, ownerId?: string) {
  return getUploadStore().get(fileId, ownerId);
}

export function listUploadedFileRecords(ownerId: string | undefined, fileIds: string[]) {
  const uniqueIds = Array.from(
    new Set(fileIds.map((fileId) => fileId.trim()).filter(Boolean))
  ).slice(0, 500);

  return uniqueIds
    .map((fileId) => getUploadedFileRecord(fileId, ownerId))
    .filter((record): record is UploadedFileRecord => Boolean(record));
}

function uploadExpiresAt(record: UploadedFileRecord) {
  const value = record.metadata?.expiresAt;
  return typeof value === "string" ? value : undefined;
}

function isUploadExpired(record: UploadedFileRecord, now = Date.now()) {
  const expiresAt = uploadExpiresAt(record);
  return expiresAt ? Date.parse(expiresAt) <= now : false;
}

export async function cleanupExpiredUploadedFiles(ownerId?: string) {
  if (!ownerId) return [];
  const store = getUploadStore();
  const expired = store.list(ownerId, 200).filter((record) => isUploadExpired(record));
  await Promise.all(
    expired.map(async (record) => {
      store.delete(record.id, ownerId);
      await unlink(record.storedPath).catch(() => undefined);
    })
  );
  return expired;
}

export async function listUploadedFilesForOwner(ownerId: string, limit = 80) {
  await cleanupExpiredUploadedFiles(ownerId);
  return getUploadStore()
    .list(ownerId, limit)
    .filter((record) => !isUploadExpired(record));
}

export async function deleteUploadedFileForOwner(fileId: string, ownerId: string) {
  const store = getUploadStore();
  const record = store.get(fileId, ownerId);
  if (!record) return undefined;
  store.delete(fileId, ownerId);
  await unlink(record.storedPath).catch(() => undefined);
  return record;
}

function sanitizeFilename(value: string) {
  return basename(value)
    .replace(/[/:*?"<>|\\]/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 160);
}

function normalizeText(value: string, limit = TEXT_PREVIEW_LIMIT) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .trim()
    .slice(0, limit);
}

function decodeText(buffer: Buffer) {
  const utf8 = buffer.toString("utf8");
  const replacementCount = (utf8.match(/\uFFFD/g) ?? []).length;
  if (replacementCount < Math.max(3, utf8.length * 0.03)) return utf8;
  return buffer.toString("latin1");
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlUnescape(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function extractXmlText(value: string) {
  return normalizeText(
    xmlUnescape(
      value
        .replace(/<\/(w:p|p|row|si)>/g, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
    )
  );
}

function parseCsvPreview(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length && rows.length < 12; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && quoted && nextChar === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  if (cell || row.length > 0) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }

  return rows;
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 65557);

  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }

  throw new Error("ZIP 结构不完整，未找到中央目录。");
}

function listZipEntries(buffer: Buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("ZIP 中央目录损坏。");
    }

    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer
      .subarray(centralOffset + 46, centralOffset + 46 + fileNameLength)
      .toString("utf8");

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`ZIP 本地文件头损坏：${entry.name}`);
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`暂不支持的 ZIP 压缩方式：${entry.compressionMethod}`);
}

function readZipText(buffer: Buffer, entryName: string) {
  const entry = listZipEntries(buffer).find((item) => item.name === entryName);
  if (!entry) return null;
  return readZipEntry(buffer, entry).toString("utf8");
}

function readDocx(buffer: Buffer) {
  const documentXml = readZipText(buffer, "word/document.xml");
  if (!documentXml) {
    throw new Error("DOCX 中没有找到 word/document.xml。");
  }

  const paragraphText = documentXml
    .replace(/<\/w:p>/g, "\n")
    .match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)
    ?.map((item) => xmlUnescape(item.replace(/<[^>]+>/g, "")))
    .join(" ");
  const text = paragraphText ? normalizeText(paragraphText) : extractXmlText(documentXml);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    metadata: {
      format: "docx",
      wordCount
    }
  };
}

function readSharedStrings(buffer: Buffer) {
  const sharedXml = readZipText(buffer, "xl/sharedStrings.xml");
  if (!sharedXml) return [];

  return Array.from(sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((match) =>
    normalizeText(
      Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
        .map((textMatch) => xmlUnescape(textMatch[1]))
        .join("")
    )
  );
}

function readXlsx(buffer: Buffer) {
  const entries = listZipEntries(buffer).filter((entry) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)
  );
  if (entries.length === 0) {
    throw new Error("XLSX 中没有找到工作表。");
  }

  const sharedStrings = readSharedStrings(buffer);
  const sheetPreviews: string[] = [];
  let totalRows = 0;

  for (const [sheetIndex, entry] of entries.slice(0, 5).entries()) {
    const xml = readZipEntry(buffer, entry).toString("utf8");
    const rows: string[][] = [];

    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= 12) break;
      const values: string[] = [];

      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attributes = cellMatch[1];
        const body = cellMatch[2];
        const type = attributes.match(/\bt="([^"]+)"/)?.[1];
        const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
        const inlineValue = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1];

        if (type === "s") {
          values.push(sharedStrings[Number(rawValue)] ?? rawValue);
        } else if (type === "inlineStr" && inlineValue) {
          values.push(xmlUnescape(inlineValue));
        } else {
          values.push(xmlUnescape(rawValue));
        }
      }

      if (values.some(Boolean)) rows.push(values);
    }

    totalRows += (xml.match(/<row\b/g) ?? []).length;
    sheetPreviews.push(
      [`Sheet ${sheetIndex + 1}`, ...rows.map((row) => row.slice(0, 10).join(" | "))].join("\n")
    );
  }

  return {
    text: normalizeText(sheetPreviews.join("\n\n")),
    metadata: {
      format: "xlsx",
      sheets: entries.length,
      previewedSheets: Math.min(entries.length, 5),
      rows: totalRows
    }
  };
}

function readJpegSize(buffer: Buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebpSize(buffer: Buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }

  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }
  return null;
}

function readImage(buffer: Buffer, extension: string) {
  let format = extension.replace(".", "").toLowerCase();
  let size: { width: number; height: number } | null = null;

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    format = "png";
    size = {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  } else if (buffer.toString("ascii", 0, 3) === "GIF") {
    format = "gif";
    size = {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8)
    };
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    format = "jpeg";
    size = readJpegSize(buffer);
  } else {
    size = readWebpSize(buffer);
    if (size) format = "webp";
  }

  const dimensions = size ? `${size.width}x${size.height}` : "未知尺寸";
  return {
    text: `图片文件，格式 ${format.toUpperCase()}，尺寸 ${dimensions}。当前版本已读取图片元数据；OCR 文字提取和批量图片处理会作为后续增强继续接入。`,
    metadata: {
      format: "image",
      imageFormat: format || "unknown",
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      ocrReadable: false
    }
  };
}

function decodePdfLiteral(value: string) {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, escaped: string) => {
      const table: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        "(": "(",
        ")": ")",
        "\\": "\\"
      };
      return table[escaped] ?? escaped;
    })
    .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

interface PdfStream {
  dictionary: string;
  content: string;
}

function inflatePdfStream(stream: Buffer, dictionary: string) {
  if (!/\/FlateDecode\b/.test(dictionary)) return stream.toString("latin1");

  try {
    return inflateSync(stream).toString("latin1");
  } catch {
    return inflateRawSync(stream).toString("latin1");
  }
}

function extractPdfStreams(buffer: Buffer): PdfStream[] {
  const chunks: PdfStream[] = [];
  let searchOffset = 0;

  while (searchOffset < buffer.length) {
    const streamStart = buffer.indexOf("stream", searchOffset, "latin1");
    if (streamStart === -1) break;
    const streamDataStart =
      buffer[streamStart + 6] === 0x0d && buffer[streamStart + 7] === 0x0a
        ? streamStart + 8
        : buffer[streamStart + 6] === 0x0a
          ? streamStart + 7
          : streamStart + 6;
    const streamEnd = buffer.indexOf("endstream", streamDataStart, "latin1");
    if (streamEnd === -1) break;

    const dictionary = buffer
      .subarray(Math.max(0, streamStart - 700), streamStart)
      .toString("latin1");
    const dataEnd =
      buffer[streamEnd - 2] === 0x0d && buffer[streamEnd - 1] === 0x0a
        ? streamEnd - 2
        : buffer[streamEnd - 1] === 0x0a
          ? streamEnd - 1
          : streamEnd;
    const stream = buffer.subarray(streamDataStart, dataEnd);

    try {
      chunks.push({
        dictionary,
        content: inflatePdfStream(stream, dictionary)
      });
    } catch {
      chunks.push({
        dictionary,
        content: stream.toString("latin1")
      });
    }

    searchOffset = streamEnd + 9;
  }

  return chunks;
}

function decodeUtf16BeHex(hex: string) {
  const codeUnits: number[] = [];
  for (let index = 0; index + 3 < hex.length; index += 4) {
    codeUnits.push(parseInt(hex.slice(index, index + 4), 16));
  }

  const codePoints: number[] = [];
  for (let index = 0; index < codeUnits.length; index += 1) {
    const current = codeUnits[index];
    const next = codeUnits[index + 1];
    if (current >= 0xd800 && current <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      codePoints.push(((current - 0xd800) << 10) + (next - 0xdc00) + 0x10000);
      index += 1;
    } else {
      codePoints.push(current);
    }
  }

  return String.fromCodePoint(...codePoints);
}

function parseToUnicodeCMap(value: string) {
  const map = new Map<number, string>();

  for (const section of value.matchAll(/beginbfchar\s+([\s\S]*?)\s+endbfchar/g)) {
    for (const entry of section[1].matchAll(/<([0-9a-f]+)>\s+<([0-9a-f]+)>/gi)) {
      map.set(parseInt(entry[1], 16), decodeUtf16BeHex(entry[2]));
    }
  }

  for (const section of value.matchAll(/beginbfrange\s+([\s\S]*?)\s+endbfrange/g)) {
    for (const entry of section[1].matchAll(
      /<([0-9a-f]+)>\s+<([0-9a-f]+)>\s+(\[[\s\S]*?\]|<[^>]+>)/gi
    )) {
      const start = parseInt(entry[1], 16);
      const end = parseInt(entry[2], 16);
      const target = entry[3];

      if (target.startsWith("[")) {
        const values = Array.from(target.matchAll(/<([0-9a-f]+)>/gi)).map((item) =>
          decodeUtf16BeHex(item[1])
        );
        values.forEach((text, offset) => {
          if (start + offset <= end) map.set(start + offset, text);
        });
      } else {
        const firstCode = parseInt(target.replace(/[<>]/g, ""), 16);
        for (let code = start; code <= end; code += 1) {
          map.set(code, String.fromCodePoint(firstCode + code - start));
        }
      }
    }
  }

  return map;
}

function buildPdfFontMaps(raw: string, streams: PdfStream[]) {
  const toUnicodeMaps = new Map<number, Map<number, string>>();
  const objects: Array<{ id: number; body: string }> = [];

  for (const objectMatch of raw.matchAll(/(?:^|\n)(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g)) {
    const objectId = Number(objectMatch[1]);
    const objectBody = objectMatch[2];
    objects.push({ id: objectId, body: objectBody });
    if (objectBody.includes("begincmap")) {
      toUnicodeMaps.set(objectId, parseToUnicodeCMap(objectBody));
    }
  }

  for (const stream of streams) {
    if (stream.content.includes("begincmap")) {
      const lengthMatch = stream.dictionary.match(/(\d+)\s+0\s+obj/);
      const objectId = lengthMatch ? Number(lengthMatch[1]) : undefined;
      if (objectId) toUnicodeMaps.set(objectId, parseToUnicodeCMap(stream.content));
    }
  }

  const fontObjectMaps = new Map<number, Map<number, string>>();
  for (const object of objects) {
    if (!/\/Type\s*\/Font\b/.test(object.body)) continue;
    const toUnicodeObjectId = Number(object.body.match(/\/ToUnicode\s+(\d+)\s+0\s+R/)?.[1]);
    if (!toUnicodeObjectId) continue;
    const cmap = toUnicodeMaps.get(toUnicodeObjectId);
    if (cmap) fontObjectMaps.set(object.id, cmap);
  }

  const fontNameMaps = new Map<string, Map<number, string>>();
  for (const fontSection of raw.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) {
    for (const fontRef of fontSection[1].matchAll(/\/([A-Za-z0-9_.-]+)\s+(\d+)\s+0\s+R/g)) {
      const cmap = fontObjectMaps.get(Number(fontRef[2]));
      if (cmap) fontNameMaps.set(fontRef[1], cmap);
    }
  }

  return fontNameMaps;
}

function decodePdfHexWithCMap(hex: string, cmap?: Map<number, string>) {
  const normalized = hex.replace(/\s+/g, "");
  if (!cmap || cmap.size === 0) return decodeText(Buffer.from(normalized, "hex"));

  const pieces: string[] = [];
  for (let index = 0; index + 3 < normalized.length; index += 4) {
    const code = parseInt(normalized.slice(index, index + 4), 16);
    pieces.push(cmap.get(code) ?? "");
  }
  return pieces.join("");
}

function latin1ToHex(value: string) {
  return Array.from(value)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

function isReadablePdfText(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 12) return false;

  const useful = compact.match(/[\p{Script=Han}\p{L}\p{N}]/gu)?.length ?? 0;
  const broken = compact.match(/[\u0000-\u001f\u007f-\u009f\uFFFD□�]/gu)?.length ?? 0;
  const suspicious = compact.match(/[þÿÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß]/g)?.length ?? 0;

  return useful / compact.length >= 0.42 && (broken + suspicious) / compact.length < 0.08;
}

function cleanupPdfText(value: string) {
  return normalizeText(
    value
      .replace(/\u200b/g, "")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/([。！？；])\s+/g, "$1\n")
      .replace(/\n{3,}/g, "\n\n")
  );
}

function isPdfContentStream(stream: PdfStream) {
  if (/\/Subtype\s*\/Image\b/.test(stream.dictionary)) return false;
  if (/\/FontFile\d?\b|\/Length1\b/.test(stream.dictionary)) return false;
  return /\bBT\b/.test(stream.content) && /(?:Tj|TJ|')/.test(stream.content);
}

function findExecutable(candidates: string[]) {
  return candidates.find((candidate) => existsSync(candidate));
}

async function runTextCommand(command: string, args: string[], timeoutMs: number) {
  const { stdout } = await execFileAsync(command, args, {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024
  });
  return normalizeText(String(stdout), PDF_EXTRACTION_LIMIT);
}

async function readPdfWithPdftotext(filePath: string) {
  const pdftotext = findExecutable([
    "/opt/homebrew/bin/pdftotext",
    "/usr/local/bin/pdftotext",
    "/usr/bin/pdftotext"
  ]);
  if (!pdftotext) return "";

  try {
    return await runTextCommand(pdftotext, ["-layout", filePath, "-"], 10000);
  } catch {
    return "";
  }
}

async function readPdfWithPython(filePath: string) {
  const python = findExecutable([
    "/opt/anaconda3/bin/python3",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3"
  ]);
  if (!python) return "";

  const script = [
    "import sys",
    "path = sys.argv[1]",
    "text = ''",
    "try:",
    "    import pdfplumber",
    "    with pdfplumber.open(path) as pdf:",
    "        text = '\\n'.join((page.extract_text() or '') for page in pdf.pages[:20])",
    "except Exception:",
    "    try:",
    "        from pypdf import PdfReader",
    "        reader = PdfReader(path)",
    "        text = '\\n'.join((page.extract_text() or '') for page in reader.pages[:20])",
    "    except Exception:",
    "        text = ''",
    "sys.stdout.write(text)"
  ].join("\n");

  try {
    return await runTextCommand(python, ["-c", script, filePath], 12000);
  } catch {
    return "";
  }
}

async function readPdfWithTesseract(filePath: string) {
  const sips = findExecutable(["/usr/bin/sips"]);
  const tesseract = findExecutable([
    "/opt/homebrew/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/usr/bin/tesseract"
  ]);
  if (!sips || !tesseract) return "";

  const tempDir = await mkdtemp(join(tmpdir(), "manusxl-pdf-ocr-"));
  const pngPath = join(tempDir, "page.png");
  try {
    await execFileAsync(sips, ["-s", "format", "png", filePath, "--out", pngPath], {
      timeout: 10000,
      maxBuffer: 1024 * 1024
    });

    for (const language of ["chi_sim+eng", "eng"]) {
      try {
        const text = await runTextCommand(tesseract, [pngPath, "stdout", "-l", language, "--psm", "6"], 25000);
        if (isReadablePdfText(text)) return text;
      } catch {
        // Try the next installed language set.
      }
    }
    return "";
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readPdfWithExternalTools(filePath: string) {
  const candidates = [
    { extraction: "pdftotext", text: await readPdfWithPdftotext(filePath) },
    { extraction: "python-pdf", text: await readPdfWithPython(filePath) }
  ];
  const textCandidate = candidates.find((candidate) => isReadablePdfText(candidate.text));
  if (textCandidate) return textCandidate;

  const ocrText = await readPdfWithTesseract(filePath);
  if (isReadablePdfText(ocrText)) return { extraction: "ocr-first-page", text: ocrText };
  return { extraction: "", text: "" };
}

function extractPdfTextFromOperators(content: string, fontMaps = new Map<string, Map<number, string>>()) {
  const pieces: string[] = [];
  let activeCMap: Map<number, string> | undefined;
  const tokenPattern =
    /\/([A-Za-z0-9_.-]+)\s+[-\d.]+\s+Tf|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dmD]|\bT\*|ET|<([0-9a-fA-F\s]+)>\s*Tj|\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")|\[[\s\S]{0,5000}?\]\s*TJ/g;

  for (const match of content.matchAll(tokenPattern)) {
    const token = match[0];

    if (match[1]) {
      activeCMap = fontMaps.get(match[1]);
      continue;
    }

    if (match[2] && Math.abs(Number(match[3])) > 0.01) {
      pieces.push("\n");
      continue;
    }

    if (token === "T*" || token === "ET") {
      pieces.push("\n");
      continue;
    }

    const hexText = token.match(/^<([0-9a-fA-F\s]+)>\s*Tj/);
    if (hexText) {
      pieces.push(decodePdfHexWithCMap(hexText[1], activeCMap));
      continue;
    }

    if (token.endsWith("TJ")) {
      for (const hexItem of token.matchAll(/<([0-9a-fA-F\s]+)>/g)) {
        pieces.push(decodePdfHexWithCMap(hexItem[1], activeCMap));
      }
      for (const literalItem of token.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
        const decoded = decodePdfLiteral(literalItem[0].slice(1, -1));
        pieces.push(decodePdfHexWithCMap(latin1ToHex(decoded), activeCMap));
      }
      continue;
    }

    const literalText = token.match(/^\((?:\\.|[^\\)])*\)/);
    if (literalText) {
      const decoded = decodePdfLiteral(literalText[0].slice(1, -1));
      pieces.push(activeCMap ? decodePdfHexWithCMap(latin1ToHex(decoded), activeCMap) : decoded);
    }
  }

  return cleanupPdfText(pieces.join(""));
}

async function readPdf(buffer: Buffer, filePath?: string) {
  const raw = buffer.toString("latin1");
  const streams = extractPdfStreams(buffer);
  const fontMaps = buildPdfFontMaps(raw, streams);
  const content = streams
    .filter(isPdfContentStream)
    .map((stream) => stream.content)
    .join("\n");
  const decodedText = extractPdfTextFromOperators(content, fontMaps);
  const fallbackText = extractPdfTextFromOperators(`${content}\n${raw}`);
  let text = isReadablePdfText(decodedText) ? decodedText : isReadablePdfText(fallbackText) ? fallbackText : "";
  let extraction = text ? (isReadablePdfText(decodedText) ? "to-unicode-cmap" : "operator-fallback") : "";

  if (!text && filePath) {
    const external = await readPdfWithExternalTools(filePath);
    if (external.text) {
      text = external.text;
      extraction = external.extraction;
    }
  }

  return {
    text:
      text ||
      "这个 PDF 可能是扫描图片、加密文档，或使用了当前版本无法解析的字体编码。已读取文件结构，但没有抽取到可信正文；建议上传可复制文字版 PDF，或后续接入 OCR 后再分析。",
    metadata: {
      format: "pdf",
      pages: (raw.match(/\/Type\s*\/Page\b/g) ?? []).length,
      imageObjects: (raw.match(/\/Subtype\s*\/Image\b/g) ?? []).length,
      textReadable: Boolean(text),
      ocrApplied: extraction === "ocr-first-page",
      extraction: extraction || "unreadable"
    }
  };
}

function summarizeText(name: string, text: string, metadata: Record<string, string | number | boolean>) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0] ?? text.slice(0, 120);
  const extra =
    metadata.format === "xlsx"
      ? `，共 ${metadata.sheets ?? 0} 个工作表`
      : metadata.format === "pdf"
        ? `，约 ${metadata.pages ?? 0} 页`
        : metadata.format === "image"
          ? `，${metadata.imageFormat ?? "image"} ${metadata.width ?? 0}x${metadata.height ?? 0}`
        : "";

  return `已读取 ${name}${extra}。正文预览：${firstLine.slice(0, 180) || "暂无可读文本"}`;
}

export async function analyzeStoredFile(input: {
  id?: string;
  name: string;
  mimeType: string;
  size: number;
  storedPath: string;
}): Promise<UploadedFileSummary> {
  if (!existsSync(input.storedPath)) {
    throw new Error("上传文件不存在。");
  }

  const buffer = await readFile(input.storedPath);
  const extension = extname(input.name).toLowerCase();
  let text = "";
  let metadata: Record<string, string | number | boolean> = {
    format: extension.replace(".", "") || input.mimeType || "unknown"
  };

  if ([".txt", ".md", ".markdown", ".json", ".xml"].includes(extension)) {
    text = normalizeText(decodeText(buffer));
  } else if ([".html", ".htm"].includes(extension)) {
    text = normalizeText(stripHtml(decodeText(buffer)));
  } else if ([".csv", ".tsv"].includes(extension)) {
    const decoded = normalizeText(decodeText(buffer), 12000);
    const rows = parseCsvPreview(decoded);
    text = normalizeText(rows.map((row) => row.join(" | ")).join("\n"));
    metadata = {
      format: extension === ".tsv" ? "tsv" : "csv",
      previewRows: rows.length,
      columns: rows[0]?.length ?? 0
    };
  } else if (extension === ".pdf" || input.mimeType === "application/pdf") {
    const parsed = await readPdf(buffer, input.storedPath);
    text = parsed.text;
    metadata = parsed.metadata;
  } else if (
    [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension) ||
    input.mimeType.startsWith("image/")
  ) {
    const parsed = readImage(buffer, extension);
    text = parsed.text;
    metadata = parsed.metadata;
  } else if (
    extension === ".docx" ||
    input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const parsed = readDocx(buffer);
    text = parsed.text;
    metadata = parsed.metadata;
  } else if (
    extension === ".xlsx" ||
    input.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    const parsed = readXlsx(buffer);
    text = parsed.text;
    metadata = parsed.metadata;
  } else {
    throw new Error("暂不支持该文件类型。请上传 TXT、MD、JSON、CSV、HTML、PDF、DOCX 或 XLSX。");
  }

  const textPreview = normalizeText(text);
  return {
    id: input.id ?? createId("file"),
    name: input.name,
    mimeType: input.mimeType || "application/octet-stream",
    extension: extension || "unknown",
    size: input.size,
    textPreview,
    summary: summarizeText(input.name, textPreview, metadata),
    metadata
  };
}

export async function saveUploadedFile(file: File, ownerId?: string) {
  const size = file.size;
  if (size <= 0) throw new Error("文件为空。");
  if (size > MAX_UPLOAD_BYTES) throw new Error("文件超过 25MB，当前版本暂不处理。");

  const id = createId("upload");
  const safeName = sanitizeFilename(file.name || "upload.bin");
  const uploadRoot = ownerId ? dataPath("uploads", ownerId) : dataPath("uploads");
  await mkdir(uploadRoot, { recursive: true });

  const storedPath = join(uploadRoot, `${id}-${safeName}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(storedPath, buffer);

  return {
    id,
    name: safeName,
    mimeType: file.type || "application/octet-stream",
    size,
    storedPath
  };
}

export async function saveUploadedFileBuffer(input: {
  name: string;
  mimeType?: string;
  buffer: Buffer;
  ownerId?: string;
}) {
  const size = input.buffer.byteLength;
  if (size <= 0) throw new Error("文件为空。");
  if (size > MAX_UPLOAD_BYTES) throw new Error("文件超过 25MB，当前版本暂不处理。");

  const id = createId("upload");
  const safeName = sanitizeFilename(input.name || "upload.bin");
  const uploadRoot = input.ownerId ? dataPath("uploads", input.ownerId) : dataPath("uploads");
  await mkdir(uploadRoot, { recursive: true });

  const storedPath = join(uploadRoot, `${id}-${safeName}`);
  await writeFile(storedPath, input.buffer);

  return {
    id,
    name: safeName,
    mimeType: input.mimeType || "application/octet-stream",
    size,
    storedPath
  };
}

export async function saveAndAnalyzeUpload(file: File, ownerId?: string) {
  const stored = await saveUploadedFile(file, ownerId);
  const summary = await analyzeStoredFile(stored);
  saveUploadRecord({
    ...summary,
    ownerId,
    storedPath: stored.storedPath,
    createdAt: new Date().toISOString()
  });
  return summary;
}

export async function saveAndAnalyzeUploadBuffer(input: {
  name: string;
  mimeType?: string;
  buffer: Buffer;
  ownerId?: string;
  metadata?: Record<string, string | number | boolean>;
}) {
  const stored = await saveUploadedFileBuffer(input);
  const summary = await analyzeStoredFile(stored);
  const enriched = {
    ...summary,
    metadata: {
      ...summary.metadata,
      ...(input.metadata ?? {})
    }
  };
  saveUploadRecord({
    ...enriched,
    ownerId: input.ownerId,
    storedPath: stored.storedPath,
    createdAt: new Date().toISOString()
  });
  return enriched;
}
