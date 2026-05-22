const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 180000);
const phone = process.env.MANUSXL_E2E_PHONE ?? "18800000001";

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
    const data = buffer.subarray(dataOffset, dataOffset + compressedSize);

    entries.push({ name, data });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
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

async function analyzeUpload(name, content, type) {
  const formData = new FormData();
  formData.set("file", new File([content], name, { type }));

  const uploaded = await fetchJson("/api/files/analyze", {
    method: "POST",
    body: formData
  });
  assert(uploaded.file?.summary, `${name} 没有返回解析摘要`);
  console.log(`上传解析通过：${uploaded.file.name}`);
  return uploaded.file;
}

function uploadedFileBlock(file) {
  return [
    `文件：${file.name}`,
    `类型：${file.extension}，大小：${file.size} bytes`,
    `摘要：${file.summary}`,
    `正文预览：${file.textPreview}`
  ].join("\n");
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

function artifactByName(task, name) {
  const artifact = task.artifacts.find((item) => item.name === name);
  assert(artifact, `缺少 ${name} 交付物`);
  return artifact;
}

async function main() {
  console.log(`ManusXL batch files E2E base URL: ${baseUrl}`);
  await loginForE2E();

  const files = await Promise.all([
    analyzeUpload(
      "invoice-notes.txt",
      "供应商：星河科技\n日期：2026-05-22\n金额：12800\n用途：云服务采购",
      "text/plain"
    ),
    analyzeUpload(
      "sales-ranking.csv",
      "公司,类别,金额\n比亚迪,新能源车,120\n吉利银河,新能源车,86",
      "text/csv"
    )
  ]);

  const config = await fetchJson("/api/config");
  const taskPrompt = [
    "请批量重命名并按类别分类我上传的文件，输出 dry-run 清单和可下载批处理包。",
    "",
    "[上传文件摘要]",
    files.map(uploadedFileBlock).join("\n")
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
  assert(
    events.some((event) => event.type === "tool_call" && event.payload?.toolName === "batch_file_ops"),
    "任务没有调用 batch_file_ops"
  );

  const planJson = JSON.parse((await fetchBuffer(artifactByName(task, "batch-file-ops-plan.json").url)).toString("utf8"));
  assert(planJson.operations?.length === 2, "批量操作清单数量不正确");
  assert(
    planJson.operations.every((operation) => operation.dryRun === true),
    "批量操作清单必须默认 dry-run"
  );
  assert(
    planJson.operations.some((operation) => operation.target.includes("documents/")) &&
      planJson.operations.some((operation) => operation.target.includes("spreadsheets/")),
    "批量分类结果缺少 documents/spreadsheets 目标目录"
  );

  const csv = (await fetchBuffer(artifactByName(task, "batch-file-ops-plan.csv").url)).toString("utf8");
  assert(csv.includes("operation,source,target,category,dryRun"), "CSV 清单表头不正确");

  const shell = (await fetchBuffer(artifactByName(task, "apply-batch-file-ops.sh").url)).toString("utf8");
  assert(shell.includes("DRY_RUN=${DRY_RUN:-1}"), "批处理脚本没有默认 dry-run");

  const zipEntries = readZipEntries(await fetchBuffer(artifactByName(task, "batch-file-ops-package.zip").url)).map(
    (entry) => entry.name
  );
  ["README.md", "batch-plan.json", "batch-plan.csv", "apply-batch-ops.sh"].forEach((name) => {
    assert(zipEntries.includes(name), `批处理 ZIP 缺少 ${name}`);
  });

  console.log("批量文件 E2E 通过：上传解析、Agent 调用、dry-run JSON/CSV/脚本/ZIP 均已检查。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
