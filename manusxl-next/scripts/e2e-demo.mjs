import { inflateRawSync } from "node:zlib";

const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 180000);
const runs = Math.max(1, Number(process.env.MANUSXL_E2E_RUNS ?? 1));
const phone = process.env.MANUSXL_E2E_PHONE ?? "18800000001";
const prompt =
  process.env.MANUSXL_E2E_PROMPT ??
  "调研中国新能源车前五家公司（销量排序），生成对比 Excel + 5 页汇报 PPT + 一页 dashboard 网页";

const cookieJar = new Map();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function mergeHeaders(headers = {}) {
  const merged = new Headers(headers);
  const cookies = cookieHeader();
  if (cookies) merged.set("Cookie", cookies);
  return merged;
}

function rememberCookies(headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return;

  raw
    .split(/,\s*(?=[^;]+=)/)
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .forEach((cookie) => {
      const separator = cookie.indexOf("=");
      if (separator <= 0) return;
      cookieJar.set(cookie.slice(0, separator), cookie.slice(separator + 1));
    });
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("ZIP 结构不完整：未找到 central directory");
}

function readZipEntries(buffer) {
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    assert(buffer.readUInt32LE(centralOffset) === 0x02014b50, "ZIP central directory 损坏");

    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer
      .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString("utf8");

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 8 ? inflateRawSync(compressed) : compressed;

    entries.push({ name, data });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function getZipText(buffer, entryName) {
  const entry = readZipEntries(buffer).find((item) => item.name === entryName);
  assert(entry, `ZIP 中缺少 ${entryName}`);
  return entry.data.toString("utf8");
}

async function fetchJson(pathname, init) {
  const response = await fetch(url(pathname), {
    ...init,
    headers: mergeHeaders(init?.headers)
  });
  rememberCookies(response.headers);
  const body = await response.text();
  assert(response.ok, `${pathname} 请求失败：${response.status} ${body}`);
  return JSON.parse(body);
}

async function fetchBuffer(pathname) {
  const response = await fetch(url(pathname), { headers: mergeHeaders() });
  rememberCookies(response.headers);
  const body = Buffer.from(await response.arrayBuffer());
  assert(response.ok, `${pathname} 下载失败：${response.status}`);
  assert(body.length > 0, `${pathname} 下载为空`);
  return body;
}

async function waitForTask(taskId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url(`/api/tasks/${taskId}/events`), {
    headers: mergeHeaders(),
    signal: controller.signal
  });
  rememberCookies(response.headers);

  assert(response.ok, `SSE 连接失败：${response.status}`);
  assert(response.body, "当前 Node 版本不支持读取 SSE stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");

        if (data) {
          const event = JSON.parse(data);
          events.push(event);
          process.stdout.write(`· ${event.type}: ${event.title ?? "Agent event"}\n`);
          if (event.type === "finished") return events;
          if (event.type === "failed") {
            throw new Error(`任务失败：${event.content ?? "unknown error"}`);
          }
        }

        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }

  return events;
}

async function replayTaskEvents(taskId, lastEventId) {
  const pathname = `/api/tasks/${taskId}/events?lastEventId=${encodeURIComponent(lastEventId)}`;
  const response = await fetch(url(pathname), { headers: mergeHeaders() });
  rememberCookies(response.headers);

  assert(response.ok, `SSE 回放连接失败：${response.status}`);
  assert(response.body, "当前 Node 版本不支持读取 SSE replay stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) events.push(JSON.parse(data));
      boundary = buffer.indexOf("\n\n");
    }
  }

  return events;
}

async function loginForE2E() {
  const requested = await fetchJson("/api/auth/phone/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
  assert(requested.verificationCode, "开发验证码没有返回");

  const verified = await fetchJson("/api/auth/phone/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code: requested.verificationCode })
  });
  assert(verified.user?.id, "手机号登录没有返回用户信息");
  console.log(`已登录 E2E 用户：${verified.user.phone ?? phone}`);
}

async function analyzeFixtureUpload(runIndex) {
  const csv = [
    "公司,销量排名,核心观察",
    "比亚迪,1,插混和纯电双线领先",
    "特斯拉中国,2,高端纯电品牌强势",
    "吉利银河,3,新能源矩阵扩张",
    "长安启源,4,混动产品拉动增长",
    "广汽埃安,5,网约与家庭市场基础较强"
  ].join("\n");
  const formData = new FormData();
  formData.set(
    "file",
    new File([csv], `manusxl-e2e-${runIndex}.csv`, {
      type: "text/csv"
    })
  );

  const uploaded = await fetchJson("/api/files/analyze", {
    method: "POST",
    body: formData
  });
  assert(uploaded.file?.summary, "上传文件没有返回摘要");
  assert(uploaded.file.textPreview.includes("比亚迪"), "上传文件摘要缺少 CSV 内容");
  console.log(`上传解析通过：${uploaded.file.name}，${uploaded.file.size} bytes`);
  return uploaded.file;
}

function verifyXlsx(buffer) {
  const sheetXml = getZipText(buffer, "xl/worksheets/sheet1.xml");
  const rowCount = sheetXml.match(/<row\b/g)?.length ?? 0;
  assert(rowCount >= 6, `Excel 至少需要 5 行可对比数据，当前行数 ${rowCount}`);
  assert(sheetXml.includes("SUM(E2:E11)"), "Excel 缺少评分合计公式");
}

function verifyPptx(buffer) {
  const entries = readZipEntries(buffer);
  const slideCount = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).length;
  assert(slideCount >= 5, `PPT 至少需要 5 页，当前 ${slideCount} 页`);
}

function verifyZip(buffer) {
  const entryNames = readZipEntries(buffer).map((entry) => entry.name);
  ["task-analysis.xlsx", "task-briefing.pptx", "summary.html"].forEach((name) => {
    assert(entryNames.includes(name), `ZIP 中缺少 ${name}`);
  });
}

async function runDemoOnce(runIndex) {
  const config = await fetchJson("/api/config");
  console.log(`第 ${runIndex} 轮：模型 ${config.model}；API Key：${config.hasApiKey ? "已配置" : "本地回退"}`);
  const uploadedFile = await analyzeFixtureUpload(runIndex);
  const taskPrompt = [
    prompt,
    "",
    "[上传文件摘要]",
    `文件：${uploadedFile.name}`,
    `类型：${uploadedFile.extension}，大小：${uploadedFile.size} bytes`,
    `摘要：${uploadedFile.summary}`,
    `正文预览：${uploadedFile.textPreview}`
  ].join("\n");

  const created = await fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: taskPrompt, model: config.model })
  });

  assert(created.taskId, "创建任务没有返回 taskId");
  console.log(`任务已创建：${created.taskId}`);

  const events = await waitForTask(created.taskId);
  const task = await fetchJson(`/api/tasks/${created.taskId}`);
  assert(task.status === "completed", `任务状态不是 completed：${task.status}`);

  const replayAnchor = events[Math.max(0, Math.floor(events.length / 2) - 1)];
  assert(replayAnchor?.id, "事件流缺少可用于断点续传的 event id");
  const replayedEvents = await replayTaskEvents(created.taskId, replayAnchor.id);
  assert(replayedEvents.length > 0, "断点事件回放没有返回后续事件");
  assert(replayedEvents[0].id !== replayAnchor.id, "断点事件回放重复返回了 lastEventId 对应事件");
  assert(replayedEvents.at(-1)?.type === "finished", "断点事件回放没有补到 finished 事件");

  const toolCalls = events.filter((event) => event.type === "tool_call");
  assert(toolCalls.length >= 3, `至少需要 3 次工具调用，当前 ${toolCalls.length}`);
  assert(events.some((event) => event.type === "plan"), "缺少 Agent 自主拆解计划事件");
  assert(
    toolCalls.some((event) => event.payload?.toolName === "file_reader"),
    "上传文件任务缺少 file_reader 工具调用"
  );
  assert(
    toolCalls.some((event) => event.payload?.toolName === "artifact_writer"),
    "任务缺少 artifact_writer 交付物准备调用"
  );
  assert(
    toolCalls.some((event) => event.payload?.toolName === "chart_generator"),
    "dashboard 任务缺少 chart_generator 图表调用"
  );

  const artifactByType = new Map(task.artifacts.map((artifact) => [artifact.type, artifact]));
  const xlsx = artifactByType.get("xlsx");
  const pptx = artifactByType.get("pptx");
  const html = task.artifacts.find((artifact) => artifact.name === "summary.html") ?? artifactByType.get("html");
  const zip = artifactByType.get("zip");

  assert(xlsx, "缺少 Excel 交付物");
  assert(pptx, "缺少 PPTX 交付物");
  assert(html, "缺少 HTML 交付物");
  assert(zip, "缺少 ZIP 交付物");

  verifyXlsx(await fetchBuffer(xlsx.url));
  verifyPptx(await fetchBuffer(pptx.url));
  const htmlText = (await fetchBuffer(html.url)).toString("utf8");
  assert(/<html[\s>]/i.test(htmlText) && /ManusXL|dashboard|chart|report|任务|报告/i.test(htmlText), "HTML 交付物不可读");
  verifyZip(await fetchBuffer(zip.url));

  const metrics = await fetchJson(`/api/metrics/context-cache?taskId=${created.taskId}`);
  assert(metrics.totalCalls >= 2, "缺少 Context/KV-cache 指标");
  assert(metrics.stablePrefixHits >= 1, "稳定前缀没有被复用");
  if (config.hasApiKey) {
    assert(
      metrics.metrics.every((metric) => metric.provider === "deepseek" && !metric.fallbackUsed),
      "已配置 API Key，但 LLM 调用仍然发生 fallback"
    );
  }

  const hitRate = Math.round(metrics.averageCacheHitRate * 100);
  console.log(`Context 缓存友好度：${hitRate}%`);
  if (metrics.averageCacheHitRate < 0.6) {
    console.warn("缓存友好度低于 60%，请在真实 DeepSeek 响应与更多任务样本下复测。");
  }

  console.log(`第 ${runIndex} 轮通过：任务流、实时事件、Excel、PPT、HTML、ZIP、Context 指标均已检查。`);
  return { taskId: created.taskId, hitRate };
}

async function main() {
  console.log(`ManusXL E2E base URL: ${baseUrl}`);
  console.log(`计划运行轮数：${runs}`);
  await loginForE2E();
  const results = [];

  for (let index = 1; index <= runs; index += 1) {
    results.push(await runDemoOnce(index));
  }

  const passed = results.length;
  console.log(`E2E 验收完成：${passed}/${runs} 轮通过。`);
  results.forEach((result, index) => {
    console.log(`- 第 ${index + 1} 轮：${result.taskId}，Context ${result.hitRate}%`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
