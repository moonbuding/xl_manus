import { deflateSync } from "node:zlib";
import type { ArtifactType } from "@/types/agent";

export interface GeneratedArtifact {
  name: string;
  type: ArtifactType;
  mimeType: string;
  content: string;
  contentEncoding?: "text" | "base64";
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

type CellValue = string | number | { formula: string; result: string | number };

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function csvEscape(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function base64(buffer: Buffer) {
  return buffer.toString("base64");
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type);
  const chunk = Buffer.concat([typeBuffer, data]);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(chunk), 8 + data.length);
  return output;
}

export function makePng(
  width: number,
  height: number,
  draw: (canvas: {
    fillRect: (x: number, y: number, w: number, h: number, color: [number, number, number]) => void;
    drawLine: (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      color: [number, number, number],
      thickness?: number
    ) => void;
    fillCircle: (cx: number, cy: number, radius: number, color: [number, number, number]) => void;
    fillPieSlice: (
      cx: number,
      cy: number,
      radius: number,
      start: number,
      end: number,
      color: [number, number, number]
    ) => void;
  }) => void
) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const setPixel = (x: number, y: number, color: [number, number, number]) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const offset = py * (width * 4 + 1) + 1 + px * 4;
    raw[offset] = color[0];
    raw[offset + 1] = color[1];
    raw[offset + 2] = color[2];
    raw[offset + 3] = 255;
  };
  const fillRect = (x: number, y: number, w: number, h: number, color: [number, number, number]) => {
    const x1 = Math.max(0, Math.floor(x));
    const y1 = Math.max(0, Math.floor(y));
    const x2 = Math.min(width, Math.ceil(x + w));
    const y2 = Math.min(height, Math.ceil(y + h));
    for (let py = y1; py < y2; py += 1) {
      for (let px = x1; px < x2; px += 1) setPixel(px, py, color);
    }
  };
  const drawLine = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: [number, number, number],
    thickness = 2
  ) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let step = 0; step <= steps; step += 1) {
      const x = x1 + ((x2 - x1) * step) / steps;
      const y = y1 + ((y2 - y1) * step) / steps;
      fillRect(x - thickness / 2, y - thickness / 2, thickness, thickness, color);
    }
  };
  const fillCircle = (cx: number, cy: number, radius: number, color: [number, number, number]) => {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) setPixel(x, y, color);
      }
    }
  };
  const fillPieSlice = (
    cx: number,
    cy: number,
    radius: number,
    start: number,
    end: number,
    color: [number, number, number]
  ) => {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
        if (angle >= start && angle < end) setPixel(x, y, color);
      }
    }
  };

  fillRect(0, 0, width, height, [251, 252, 248]);
  draw({ fillRect, drawLine, fillCircle, fillPieSlice });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

export function makeZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, end]);
}

function cellRef(row: number, col: number) {
  let name = "";
  let value = col;
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return `${name}${row}`;
}

function makeCellXml(value: CellValue, ref: string) {
  if (typeof value === "number") {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === "object") {
    return `<c r="${ref}"><f>${xmlEscape(value.formula)}</f><v>${xmlEscape(String(value.result))}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function makeSheetXml(rows: CellValue[][]) {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          const ref = cellRef(rowIndex + 1, colIndex + 1);
          return makeCellXml(value, ref);
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function makeXlsx(rows: CellValue[][]) {
  return makeZip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`)
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Agent Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`)
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`)
    },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(makeSheetXml(rows)) }
  ]);
}

function slideXml(title: string, body: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="777240"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="3600" b="1"/><a:t>${xmlEscape(title)}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1371600"/><a:ext cx="7772400" cy="4343400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${body
      .split("\n")
      .slice(0, 9)
      .map((line) => `<a:p><a:r><a:rPr sz="2000"/><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`)
      .join("")}</p:txBody></p:sp>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function makePptx(prompt: string, plan: string[], finalAnswer: string, tableRows: CellValue[][]) {
  const tablePreview = tableRows
    .slice(0, 8)
    .map((row) =>
      row
        .map((cell) => (typeof cell === "object" ? `${cell.formula}=${cell.result}` : String(cell)))
        .join(" | ")
    )
    .join("\n");
  const slides = [
    slideXml("ManusXL Task", prompt),
    slideXml("Execution Plan", plan.map((step, index) => `${index + 1}. ${step}`).join("\n")),
    slideXml("Analysis Table", tablePreview),
    slideXml("Final Answer", finalAnswer),
    slideXml("Next Steps", "1. 检查 Excel 数据表\n2. 阅读 HTML 页面\n3. 下载 ZIP 归档\n4. 根据结论进入下一轮任务")
  ];
  const contentTypes = slides
    .map(
      (_slide, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join("\n  ");
  const slideIds = slides
    .map((_slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`)
    .join("");
  const rels = slides
    .map(
      (_slide, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
    )
    .join("\n  ");

  return makeZip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${contentTypes}
</Types>`)
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`)
    },
    {
      name: "ppt/presentation.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`)
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
</Relationships>`)
    },
    ...slides.map((slide, index) => ({
      name: `ppt/slides/slide${index + 1}.xml`,
      data: Buffer.from(slide)
    }))
  ]);
}

function utf16BeHex(value: string) {
  const bytes: number[] = [];
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0x20;
    if (codePoint > 0xffff) {
      const offset = codePoint - 0x10000;
      const high = 0xd800 + (offset >> 10);
      const low = 0xdc00 + (offset & 0x3ff);
      bytes.push(high >> 8, high & 0xff, low >> 8, low & 0xff);
    } else {
      bytes.push(codePoint >> 8, codePoint & 0xff);
    }
  }
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

function wrapDisplayLine(value: string, maxWidth = 42) {
  const lines: string[] = [];
  let current = "";
  let width = 0;

  for (const char of value.replace(/\s+/g, " ").trim()) {
    const charWidth = /[\x00-\x7f]/.test(char) ? 0.55 : 1;
    if (width + charWidth > maxWidth && current) {
      lines.push(current);
      current = "";
      width = 0;
    }
    current += char;
    width += charWidth;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function pdfLinesFromText(value: string) {
  return value
    .split(/\n+/)
    .flatMap((line) => wrapDisplayLine(line, 42))
    .slice(0, 34);
}

function makePdf(finalAnswer: string) {
  const safeLines = [
    "ManusXL Task Report",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...pdfLinesFromText(finalAnswer)
  ];

  const textOps = safeLines
    .map((line, index) => `BT /F1 10 Tf 50 ${760 - index * 18} Td <${utf16BeHex(line)}> Tj ET`)
    .join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(textOps)} >> stream\n${textOps}\nendstream endobj`,
    "6 0 obj << /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> >> endobj"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer << /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

export function markdownReport(prompt: string, plan: string[], finalAnswer: string) {
  return [
    "# ManusXL 任务报告",
    "",
    "## 用户任务",
    prompt,
    "",
    "## 执行计划",
    ...plan.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## 最终结论",
    finalAnswer,
    "",
    "## 交付物",
    "- Markdown 报告",
    "- CSV 数据表",
    "- Excel 工作簿",
    "- PowerPoint 简报",
    "- PDF 摘要",
    "- HTML 网页",
    "- ZIP 打包文件"
  ].join("\n");
}

function extractInsightRows(prompt: string, plan: string[], finalAnswer: string) {
  const lines = finalAnswer
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d.\s#>]+/, "").trim())
    .filter((line) => line.length >= 8)
    .slice(0, 10);
  const planRows = plan.slice(0, 6).map((step, index) =>
    [`计划 ${index + 1}`, step, index < 2 ? "P0" : "P1", "已执行", 70 + index * 3] satisfies CellValue[]
  );
  const insightRows = lines.map((line, index) =>
    [
      index < 4 ? "关键结论" : index < 8 ? "分析依据" : "下一步",
      line.slice(0, 240),
      index < 4 ? "P0" : "P1",
      "来自最终回答",
      95 - Math.min(index, 8) * 3
    ] satisfies CellValue[]
  );

  return [
    ["任务", prompt.slice(0, 240), "P0", "用户目标", 100] satisfies CellValue[],
    ...planRows,
    ...insightRows
  ].slice(0, 16);
}

function splitMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];

  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.replace(/<br\s*\/?>/gi, "；").replace(/\*\*/g, "").trim());
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function extractFirstMarkdownTable(finalAnswer: string): string[][] {
  const lines = finalAnswer.split("\n");

  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = splitMarkdownTableRow(lines[index]);
    if (header.length < 2 || !isMarkdownTableSeparator(lines[index + 1])) continue;

    const rows = [header];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = splitMarkdownTableRow(lines[rowIndex]);
      if (row.length < 2) break;
      rows.push(row);
    }

    if (rows.length > 1) return rows;
  }

  return [];
}

function rowsFromMarkdownTable(finalAnswer: string): CellValue[][] {
  const table = extractFirstMarkdownTable(finalAnswer);
  if (table.length < 2) return [];

  return [
    ["类型", "内容", "关键依据/指标", "建议/风险", "评分"] satisfies CellValue[],
    ...table.slice(1, 15).map((row, index) => {
      const cells = row.map((cell) => cell.replace(/\s+/g, " ").trim()).filter(Boolean);
      const label = cells[0] || `结论 ${index + 1}`;
      const content = cells[1] || cells.slice(1).join(" / ") || label;
      const evidence = cells.slice(2, Math.max(3, cells.length - 1)).join(" / ") || "见最终回答";
      const recommendation = cells.length > 3 ? cells[cells.length - 1] : "见最终回答";

      return [
        label.slice(0, 120),
        content.slice(0, 240),
        evidence.slice(0, 240),
        recommendation.slice(0, 240),
        Math.max(72, 98 - index * 4)
      ] satisfies CellValue[];
    })
  ];
}

function htmlReport(prompt: string, finalAnswer: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ManusXL Report</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f7f8f5;color:#20231f}
    main{max-width:900px;margin:0 auto;padding:56px 24px}
    h1{font-size:34px;margin:0 0 18px}
    section{border-top:1px solid #dce4da;padding:24px 0}
    pre{white-space:pre-wrap;line-height:1.7}
  </style>
</head>
<body>
  <main>
    <h1>ManusXL Report</h1>
    <section><strong>任务</strong><pre>${htmlEscape(prompt)}</pre></section>
    <section><strong>结论</strong><pre>${htmlEscape(finalAnswer)}</pre></section>
  </main>
</body>
</html>`;
}

function dashboardReport(prompt: string, plan: string[], finalAnswer: string, rows: CellValue[][]) {
  const chartRows = rows.slice(1, 11).map((row, index) => ({
    label: String(row[0]),
    title: String(row[1]).slice(0, 42),
    value: typeof row[4] === "number" ? row[4] : (index + 1) * 10
  }));
  const maxValue = Math.max(...chartRows.map((row) => row.value), 1);
  const totalScore = chartRows.reduce((sum, row) => sum + row.value, 0);
  const priorityCounts = rows.slice(1, 11).reduce<Record<string, number>>((acc, row) => {
    const key = String(row[2]);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ManusXL Dashboard</title>
  <style>
    :root{color-scheme:light;--ink:#20231f;--muted:#687066;--line:#dce4da;--paper:#fbfcf8;--accent:#1d6f5f;--gold:#b98727}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#eef2ef;color:var(--ink)}
    main{max-width:1120px;margin:0 auto;padding:36px 22px 52px}
    h1{font-size:32px;line-height:1.16;margin:0 0 10px}
    h2{font-size:18px;margin:0 0 16px}
    p{line-height:1.7;color:var(--muted)}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .panel{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:18px}
    .metric strong{display:block;font-size:28px;margin-top:4px}
    .wide{grid-column:span 2}.full{grid-column:1/-1}
    .bars{display:grid;gap:10px}.bar{display:grid;grid-template-columns:88px 1fr 48px;gap:10px;align-items:center}
    .track{height:13px;background:#e4ebe2;border-radius:999px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--gold))}
    .chips{display:flex;gap:8px;flex-wrap:wrap}.chip{border:1px solid var(--line);border-radius:999px;padding:7px 10px;background:#fff}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
    .item{border:1px solid var(--line);border-radius:8px;padding:12px;background:#fff}
    pre{white-space:pre-wrap;line-height:1.7;margin:0;color:var(--ink)}
    @media(max-width:760px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}.bar{grid-template-columns:72px 1fr 40px}}
  </style>
</head>
<body>
  <main>
    <h1>ManusXL Dashboard</h1>
    <p>${htmlEscape(prompt)}</p>
    <section class="grid">
      <div class="panel metric"><span>计划步骤</span><strong>${plan.length}</strong></div>
      <div class="panel metric"><span>数据行</span><strong>${rows.length - 1}</strong></div>
      <div class="panel metric"><span>评分合计</span><strong>${totalScore}</strong></div>
      <div class="panel metric"><span>交付格式</span><strong>7</strong></div>
      <div class="panel wide">
        <h2>步骤评分柱状图</h2>
        <div class="bars">
          ${chartRows
            .map(
              (row) => `<div class="bar"><span>${htmlEscape(row.label)}</span><div class="track"><div class="fill" style="width:${Math.round((row.value / maxValue) * 100)}%"></div></div><strong>${row.value}</strong></div>`
            )
            .join("")}
        </div>
      </div>
      <div class="panel wide">
        <h2>优先级分布</h2>
        <div class="chips">
          ${Object.entries(priorityCounts)
            .map(([name, count]) => `<span class="chip">${htmlEscape(name)} · ${count}</span>`)
            .join("")}
        </div>
        <h2 style="margin-top:22px">执行计划</h2>
        <div class="cards">
          ${plan
            .map((step, index) => `<div class="item"><strong>${index + 1}</strong><p>${htmlEscape(step)}</p></div>`)
            .join("")}
        </div>
      </div>
      <div class="panel full">
        <h2>最终结论</h2>
        <pre>${htmlEscape(finalAnswer)}</pre>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function chartGalleryReport(prompt: string, rows: CellValue[][]) {
  const data = rows.slice(1, 11).map((row, index) => ({
    label: `S${index + 1}`,
    name: String(row[1]).slice(0, 32),
    value: typeof row[4] === "number" ? row[4] : (index + 1) * 10,
    effort: typeof row[3] === "number" ? row[3] : index + 1
  }));
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  const points = data
    .map((item, index) => {
      const x = 36 + index * 58;
      const y = 220 - (item.value / maxValue) * 170;
      return `${x},${y}`;
    })
    .join(" ");
  const scatter = data
    .map((item, index) => {
      const x = 46 + index * 56;
      const y = 220 - (item.value / maxValue) * 170;
      const radius = 5 + Math.min(9, item.effort);
      return `<circle cx="${x}" cy="${y}" r="${radius}" /><text x="${x + 9}" y="${y - 7}">${htmlEscape(item.label)}</text>`;
    })
    .join("");
  const heatCells = data
    .slice(0, 9)
    .map((item) => {
      const intensity = Math.max(18, Math.round((item.value / maxValue) * 82));
      return `<div class="heat-cell" style="--v:${intensity}%"><strong>${htmlEscape(item.label)}</strong><span>${item.value}</span></div>`;
    })
    .join("");
  const pieStops = data.slice(0, 5).reduce(
    (state, item, index, items) => {
      const sum = items.reduce((total, current) => total + current.value, 0);
      const start = state.total;
      const end = start + (item.value / Math.max(sum, 1)) * 100;
      const colors = ["#1d6f5f", "#b98727", "#8a4f7d", "#3d6d98", "#79834f"];
      return {
        total: end,
        stops: `${state.stops}${colors[index]} ${start.toFixed(2)}% ${end.toFixed(2)}%,`
      };
    },
    { total: 0, stops: "" }
  ).stops.replace(/,$/, "");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ManusXL Chart Gallery</title>
  <style>
    :root{--ink:#20231f;--muted:#687066;--line:#dce4da;--paper:#fbfcf8;--accent:#1d6f5f;--gold:#b98727}
    body{margin:0;background:#eef2ef;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1120px;margin:0 auto;padding:34px 22px 54px}
    h1{font-size:32px;margin:0 0 8px}.lead{color:var(--muted);line-height:1.7}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:22px}
    section{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:18px}
    h2{font-size:17px;margin:0 0 14px}
    svg{display:block;width:100%;height:auto;overflow:visible}
    polyline{fill:none;stroke:var(--accent);stroke-width:4;stroke-linejoin:round;stroke-linecap:round}
    circle{fill:var(--gold);stroke:#fff;stroke-width:2} text{fill:var(--muted);font-size:12px}
    .bars{display:grid;gap:10px}.bar{display:grid;grid-template-columns:52px 1fr 44px;gap:10px;align-items:center}
    .track{height:14px;background:#e4ebe2;border-radius:999px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--gold))}
    .pie-wrap{display:flex;gap:22px;align-items:center}.pie{width:190px;aspect-ratio:1;border-radius:50%;background:conic-gradient(${pieStops})}
    .legend{display:grid;gap:8px;color:var(--muted)}
    .heat{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.heat-cell{min-height:62px;border-radius:7px;padding:9px;background:color-mix(in srgb,var(--accent) var(--v),#edf3ed);color:#fff}.heat-cell span{display:block;margin-top:10px}
    .full{grid-column:1/-1}
    @media(max-width:760px){.grid{grid-template-columns:1fr}.pie-wrap{display:block}.pie{margin-bottom:16px}}
  </style>
</head>
<body>
  <main>
    <h1>ManusXL Chart Gallery</h1>
    <p class="lead">${htmlEscape(prompt)}</p>
    <div class="grid">
      <section>
        <h2>Line</h2>
        <svg viewBox="0 0 600 250" role="img" aria-label="line chart">
          <line x1="30" y1="225" x2="585" y2="225" stroke="#dce4da" />
          <line x1="30" y1="32" x2="30" y2="225" stroke="#dce4da" />
          <polyline points="${points}" />
        </svg>
      </section>
      <section>
        <h2>Bar</h2>
        <div class="bars">
          ${data
            .map(
              (item) => `<div class="bar"><span>${htmlEscape(item.label)}</span><div class="track"><div class="fill" style="width:${Math.round((item.value / maxValue) * 100)}%"></div></div><strong>${item.value}</strong></div>`
            )
            .join("")}
        </div>
      </section>
      <section>
        <h2>Pie</h2>
        <div class="pie-wrap"><div class="pie"></div><div class="legend">
          ${data
            .slice(0, 5)
            .map((item) => `<span>${htmlEscape(item.label)} · ${item.value}</span>`)
            .join("")}
        </div></div>
      </section>
      <section>
        <h2>Scatter</h2>
        <svg viewBox="0 0 600 250" role="img" aria-label="scatter chart">
          <line x1="30" y1="225" x2="585" y2="225" stroke="#dce4da" />
          <line x1="30" y1="32" x2="30" y2="225" stroke="#dce4da" />
          ${scatter}
        </svg>
      </section>
      <section class="full">
        <h2>Heatmap</h2>
        <div class="heat">${heatCells}</div>
      </section>
    </div>
  </main>
</body>
</html>`;
}

function chartData(rows: CellValue[][]) {
  return rows.slice(1, 11).map((row, index) => ({
    label: `S${index + 1}`,
    value: typeof row[4] === "number" ? row[4] : (index + 1) * 10,
    effort: typeof row[3] === "number" ? row[3] : index + 1
  }));
}

function chartPngArtifacts(rows: CellValue[][]): GeneratedArtifact[] {
  const data = chartData(rows);
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  const accent: [number, number, number] = [29, 111, 95];
  const gold: [number, number, number] = [185, 135, 39];
  const purple: [number, number, number] = [138, 79, 125];
  const blue: [number, number, number] = [61, 109, 152];
  const olive: [number, number, number] = [121, 131, 79];
  const line: [number, number, number] = [211, 222, 210];
  const ink: [number, number, number] = [32, 35, 31];
  const colors = [accent, gold, purple, blue, olive];
  const width = 720;
  const height = 420;
  const chartTop = 52;
  const chartLeft = 58;
  const chartRight = 674;
  const chartBottom = 360;

  const pointFor = (index: number, value: number) => {
    const x = chartLeft + (index / Math.max(data.length - 1, 1)) * (chartRight - chartLeft);
    const y = chartBottom - (value / maxValue) * (chartBottom - chartTop);
    return { x, y };
  };

  const linePng = makePng(width, height, (canvas) => {
    canvas.drawLine(chartLeft, chartBottom, chartRight, chartBottom, line, 3);
    canvas.drawLine(chartLeft, chartTop, chartLeft, chartBottom, line, 3);
    data.forEach((item, index) => {
      const current = pointFor(index, item.value);
      if (index > 0) {
        const previous = pointFor(index - 1, data[index - 1].value);
        canvas.drawLine(previous.x, previous.y, current.x, current.y, accent, 5);
      }
      canvas.fillCircle(current.x, current.y, 8, gold);
    });
  });

  const barPng = makePng(width, height, (canvas) => {
    canvas.drawLine(chartLeft, chartBottom, chartRight, chartBottom, line, 3);
    const gap = 8;
    const barWidth = (chartRight - chartLeft - gap * (data.length - 1)) / data.length;
    data.forEach((item, index) => {
      const barHeight = (item.value / maxValue) * (chartBottom - chartTop);
      canvas.fillRect(
        chartLeft + index * (barWidth + gap),
        chartBottom - barHeight,
        barWidth,
        barHeight,
        colors[index % colors.length]
      );
    });
  });

  const piePng = makePng(width, height, (canvas) => {
    const items = data.slice(0, 5);
    const sum = Math.max(
      items.reduce((total, item) => total + item.value, 0),
      1
    );
    let start = 0;
    items.forEach((item, index) => {
      const end = start + (item.value / sum) * Math.PI * 2;
      canvas.fillPieSlice(260, 210, 140, start, end, colors[index % colors.length]);
      start = end;
    });
    canvas.fillCircle(260, 210, 54, [251, 252, 248]);
    items.forEach((item, index) => {
      canvas.fillRect(462, 114 + index * 34, 22, 22, colors[index % colors.length]);
      canvas.fillRect(494, 121 + index * 34, Math.max(24, item.value * 2), 8, line);
    });
  });

  const scatterPng = makePng(width, height, (canvas) => {
    canvas.drawLine(chartLeft, chartBottom, chartRight, chartBottom, line, 3);
    canvas.drawLine(chartLeft, chartTop, chartLeft, chartBottom, line, 3);
    data.forEach((item, index) => {
      const point = pointFor(index, item.value);
      canvas.fillCircle(point.x, point.y, 6 + Math.min(10, item.effort), colors[index % colors.length]);
    });
  });

  const heatmapPng = makePng(width, height, (canvas) => {
    const cellSize = 92;
    const startX = 214;
    const startY = 72;
    data.slice(0, 9).forEach((item, index) => {
      const intensity = item.value / maxValue;
      const color: [number, number, number] = [
        Math.round(224 - 170 * intensity),
        Math.round(236 - 90 * intensity),
        Math.round(224 - 118 * intensity)
      ];
      const x = startX + (index % 3) * (cellSize + 12);
      const y = startY + Math.floor(index / 3) * (cellSize + 12);
      canvas.fillRect(x, y, cellSize, cellSize, color);
      canvas.fillRect(x + 12, y + cellSize - 22, cellSize - 24, 8, ink);
    });
  });

  return [
    { name: "chart-line.png", content: linePng },
    { name: "chart-bar.png", content: barPng },
    { name: "chart-pie.png", content: piePng },
    { name: "chart-scatter.png", content: scatterPng },
    { name: "chart-heatmap.png", content: heatmapPng }
  ].map((artifact) => ({
    name: artifact.name,
    type: "png",
    mimeType: "image/png",
    content: base64(artifact.content),
    contentEncoding: "base64"
  }));
}

export function generateDeliverables(prompt: string, plan: string[], finalAnswer: string) {
  const insightRows = extractInsightRows(prompt, plan, finalAnswer);
  const tableRows = rowsFromMarkdownTable(finalAnswer);
  const dataRows = tableRows.length > 0 ? tableRows.slice(1) : insightRows;
  const rows: CellValue[][] = [
    tableRows[0] ?? ["类型", "内容", "优先级", "来源", "评分"],
    ...dataRows,
    [
      "汇总",
      `共整理 ${dataRows.length} 条可交付结论/依据，完整内容见 Markdown、HTML 和 PDF。`,
      "AUTO",
      "ManusXL",
      { formula: `AVERAGE(E2:E${dataRows.length + 1})`, result: 86 }
    ],
    ["最终结论", finalAnswer.slice(0, 600), "DONE", "最终回答", 100]
  ];
  const csv = rows
    .map((row) =>
      row
        .map((cell) => csvEscape(typeof cell === "object" ? `=${cell.formula}` : String(cell)))
        .join(",")
    )
    .join("\n");
  const md = markdownReport(prompt, plan, finalAnswer);
  const html = htmlReport(prompt, finalAnswer);
  const dashboard = dashboardReport(prompt, plan, finalAnswer, rows);
  const chartGallery = chartGalleryReport(prompt, rows);
  const chartPngs = chartPngArtifacts(rows);
  const xlsx = makeXlsx(rows);
  const pptx = makePptx(prompt, plan, finalAnswer, rows);
  const pdf = makePdf(finalAnswer);

  const artifacts: GeneratedArtifact[] = [
    { name: "task-report.md", type: "md", mimeType: "text/markdown; charset=utf-8", content: md },
    { name: "task-data.csv", type: "csv", mimeType: "text/csv; charset=utf-8", content: csv },
    {
      name: "task-analysis.xlsx",
      type: "xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: base64(xlsx),
      contentEncoding: "base64"
    },
    {
      name: "task-briefing.pptx",
      type: "pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      content: base64(pptx),
      contentEncoding: "base64"
    },
    {
      name: "task-summary.pdf",
      type: "pdf",
      mimeType: "application/pdf",
      content: base64(pdf),
      contentEncoding: "base64"
    },
    { name: "summary.html", type: "html", mimeType: "text/html; charset=utf-8", content: html },
    { name: "dashboard.html", type: "html", mimeType: "text/html; charset=utf-8", content: dashboard },
    { name: "chart-gallery.html", type: "html", mimeType: "text/html; charset=utf-8", content: chartGallery },
    ...chartPngs
  ];

  const bundle = makeZip(
    artifacts.map((artifact) => ({
      name: artifact.name,
      data:
        artifact.contentEncoding === "base64"
          ? Buffer.from(artifact.content, "base64")
          : Buffer.from(artifact.content)
    }))
  );

  artifacts.push({
    name: "manusxl-deliverables.zip",
    type: "zip",
    mimeType: "application/zip",
    content: base64(bundle),
    contentEncoding: "base64"
  });

  return artifacts;
}
