const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 240000);
const phone = process.env.MANUSXL_E2E_PHONE ?? "18800000001";
const imageCount = Number(process.env.MANUSXL_E2E_BULK_IMAGE_COUNT ?? 100);
const maxOutputBytes = Number(process.env.MANUSXL_E2E_IMAGE_MAX_BYTES ?? 500 * 1024);
const maxProcessingMs = Number(process.env.MANUSXL_E2E_IMAGE_MAX_PROCESSING_MS ?? 30000);
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
  return uploaded.file;
}

async function uploadInBatches(files, batchSize = 10) {
  const uploaded = [];
  for (let index = 0; index < files.length; index += batchSize) {
    const batch = files.slice(index, index + batchSize);
    const results = await Promise.all(
      batch.map((file) => analyzeUpload(file.name, file.content, file.type))
    );
    uploaded.push(...results);
    console.log(`已上传解析 ${uploaded.length}/${files.length} 张图片`);
  }
  return uploaded;
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
  console.log(`ManusXL bulk image E2E base URL: ${baseUrl}`);
  await loginForE2E();

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lx85QgAAAABJRU5ErkJggg==",
    "base64"
  );
  const files = Array.from({ length: imageCount }, (_, index) => ({
    name: `bulk-${String(index + 1).padStart(3, "0")}.png`,
    content: png,
    type: "image/png"
  }));
  const uploadedFiles = await uploadInBatches(files);
  const config = await fetchJson("/api/config");
  const prompt = `请批量压缩我上传的 ${imageCount} 张图片到 500KB 以内，并输出图片处理报告和 ZIP 包。`;

  const created = await fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      model: config.model,
      fileIds: uploadedFiles.map((file) => file.id)
    })
  });
  assert(created.taskId, "创建任务没有返回 taskId");
  console.log(`任务已创建：${created.taskId}`);

  const events = await waitForTask(created.taskId);
  const progressEvents = events.filter(
    (event) =>
      event.type === "message" &&
      event.title === "图片处理进度" &&
      event.payload?.progress?.tool === "batch_image_process" &&
      event.payload?.progress?.phase === "finish"
  );
  assert(progressEvents.length >= imageCount, `图片处理完成进度不足：${progressEvents.length}/${imageCount}`);

  const task = await fetchJson(`/api/tasks/${created.taskId}`);
  assert(task.status === "completed", `任务状态不是 completed：${task.status}`);
  const report = JSON.parse(
    (await fetchBuffer(artifactByName(task, "batch-image-process-report.json").url)).toString("utf8")
  );
  assert(report.operations?.length === imageCount, `图片处理报告数量不正确：${report.operations?.length}`);
  assert(
    report.operations.every((operation) => operation.status === "processed"),
    "存在未成功处理的图片"
  );
  assert(
    report.operations.every((operation) => operation.outputSizeBytes <= maxOutputBytes),
    `存在超过 ${maxOutputBytes} bytes 的输出图片`
  );
  assert(
    report.processingDurationMs <= maxProcessingMs,
    `图片处理耗时 ${report.processingDurationMs}ms，超过 ${maxProcessingMs}ms`
  );

  console.log(
    `100 张图片批处理 E2E 通过：${report.operations.length} 张，耗时 ${report.processingDurationMs}ms，均小于 ${maxOutputBytes} bytes。`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
