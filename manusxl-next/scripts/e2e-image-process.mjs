const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 180000);
const phone = process.env.MANUSXL_E2E_PHONE ?? "18800000001";
const cookieJar = new Map();

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function readZipEntryNames(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  assert(endOffset >= 0, "ZIP 结构不完整");

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let centralOffset = buffer.readUInt32LE(endOffset + 16);
  const names = [];
  for (let index = 0; index < entryCount; index += 1) {
    assert(buffer.readUInt32LE(centralOffset) === 0x02014b50, "ZIP central directory 损坏");
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    names.push(buffer.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8"));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
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
  assert(uploaded.file?.id, `${name} 没有返回文件 ID`);
  assert(uploaded.file?.metadata?.format === "image", `${name} 没有识别为图片`);
  console.log(`上传图片解析通过：${uploaded.file.name}`);
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
          if (event.type === "failed") throw new Error(`任务失败：${event.content ?? "unknown error"}`);
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
  console.log(`ManusXL image process E2E base URL: ${baseUrl}`);
  await loginForE2E();

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lx85QgAAAABJRU5ErkJggg==",
    "base64"
  );
  const image = await analyzeUpload("sample-red.png", png, "image/png");
  const config = await fetchJson("/api/config");
  const prompt = [
    "请批量压缩并把我上传的图片转换成 jpg，输出图片处理报告和 ZIP 包。",
    "",
    "[上传文件摘要]",
    uploadedFileBlock(image)
  ].join("\n");

  const created = await fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: config.model, fileIds: [image.id] })
  });
  assert(created.taskId, "创建任务没有返回 taskId");
  console.log(`任务已创建：${created.taskId}`);

  const events = await waitForTask(created.taskId);
  assert(
    events.some((event) => event.type === "tool_call" && event.payload?.toolName === "batch_image_process"),
    "任务没有调用 batch_image_process"
  );
  assert(
    events.some(
      (event) =>
        event.type === "message" &&
        event.title === "图片处理进度" &&
        event.payload?.progress?.tool === "batch_image_process"
    ),
    "图片处理没有输出进度事件"
  );

  const task = await fetchJson(`/api/tasks/${created.taskId}`);
  assert(task.status === "completed", `任务状态不是 completed：${task.status}`);

  const report = JSON.parse(
    (await fetchBuffer(artifactByName(task, "batch-image-process-report.json").url)).toString("utf8")
  );
  assert(report.operations?.length === 1, "图片处理报告数量不正确");
  assert(report.operations[0].status === "processed", `图片未成功处理：${report.operations[0].error ?? "unknown"}`);

  const zipEntries = readZipEntryNames(
    await fetchBuffer(artifactByName(task, "batch-image-process-package.zip").url)
  );
  assert(zipEntries.includes("image-process-report.json"), "图片处理 ZIP 缺少 JSON 报告");
  assert(zipEntries.some((name) => name.startsWith("images/") && name.endsWith(".jpg")), "图片处理 ZIP 缺少 JPG 结果");

  console.log("图片处理 E2E 通过：上传解析、真实挂载、batch_image_process、报告与 ZIP 均已检查。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
