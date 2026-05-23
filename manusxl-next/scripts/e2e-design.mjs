const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 140000);
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
  let parsed;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    parsed = body;
  }
  assert(response.ok, `${pathname} 请求失败：${response.status} ${body}`);
  return parsed;
}

async function fetchBuffer(pathname) {
  const response = await fetch(url(pathname), { headers: mergeHeaders() });
  assert(response.ok, `${pathname} 下载失败：${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function loginForE2E() {
  const phone = `188${String(Date.now()).slice(-8)}`;
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

async function patchDesignConfig(body) {
  const updated = await fetchJson("/api/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert(updated.designImageProvider, "配置接口没有返回图片 provider");
  return updated;
}

async function runTask(prompt) {
  const config = await fetchJson("/api/config");
  const created = await fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: config.model })
  });
  assert(created.taskId, "创建任务没有返回 taskId");
  const events = await waitForTask(created.taskId);
  const task = await fetchJson(`/api/tasks/${created.taskId}`);
  return { taskId: created.taskId, events, task };
}

function artifactByName(task, name) {
  const artifact = task.artifacts.find((item) => item.name === name);
  assert(artifact, `缺少交付物：${name}`);
  return artifact;
}

function bufferIncludes(buffer, text) {
  return buffer.includes(Buffer.from(text));
}

function assertImageGeneratorCalled(run) {
  assert(
    run.events.some((event) => event.type === "tool_call" && event.title === "image_generator"),
    "没有调用 image_generator"
  );
}

async function assertDesignArtifacts(run, expected) {
  const png = await fetchBuffer(artifactByName(run.task, "ai-design-image.png").url);
  assert(png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a", "PNG 文件头不正确");
  const svg = (await fetchBuffer(artifactByName(run.task, "ai-design-image.svg").url)).toString("utf8");
  assert(svg.includes("AI Design") && svg.includes("ManusXL"), "SVG 缺少 AI Design 标识");
  const manifest = JSON.parse(
    (await fetchBuffer(artifactByName(run.task, "ai-design-manifest.json").url)).toString("utf8")
  );
  assert(manifest.requestedProvider === expected.requestedProvider, "manifest requestedProvider 不正确");
  assert(manifest.usedProvider === expected.usedProvider, "manifest usedProvider 不正确");
  assert(manifest.fallbackUsed === expected.fallbackUsed, "manifest fallbackUsed 不正确");
  const zip = await fetchBuffer(artifactByName(run.task, "ai-design-assets.zip").url);
  assert(bufferIncludes(zip, "ai-design-image.png"), "ZIP 缺少 PNG");
  assert(bufferIncludes(zip, "ai-design-manifest.json"), "ZIP 缺少 manifest");
  return manifest;
}

async function main() {
  console.log(`ManusXL AI Design E2E base URL: ${baseUrl}`);
  await loginForE2E();

  await patchDesignConfig({
    designImageProvider: "local",
    designImageApiKey: "",
    designImageMaxPerTask: 2
  });
  const localRun = await runTask(
    "生成一张商务风格的咖啡店外观图片，16:9，用于 PPT 封面，并输出 PNG、SVG 和 manifest。"
  );
  assertImageGeneratorCalled(localRun);
  const localManifest = await assertDesignArtifacts(localRun, {
    requestedProvider: "local",
    usedProvider: "local",
    fallbackUsed: false
  });
  assert(localManifest.size.label === "16:9", "没有识别 16:9 尺寸");

  await patchDesignConfig({
    designImageProvider: "stable-diffusion",
    designImageApiKey: "",
    designImageMaxPerTask: 2
  });
  const fallbackRun = await runTask("生成一张 AI Design 插图，验证 provider 切换后没有 API Key 也不会阻塞。");
  assertImageGeneratorCalled(fallbackRun);
  const fallbackManifest = await assertDesignArtifacts(fallbackRun, {
    requestedProvider: "stable-diffusion",
    usedProvider: "local",
    fallbackUsed: true
  });
  assert(fallbackManifest.fallbackReason, "fallback 原因缺失");

  await patchDesignConfig({
    designImageProvider: "local",
    designImageApiKey: "",
    designImageMaxPerTask: 4
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        localTaskId: localRun.taskId,
        fallbackTaskId: fallbackRun.taskId,
        localProvider: localManifest.usedProvider,
        fallbackProvider: fallbackManifest.usedProvider,
        fallbackUsed: fallbackManifest.fallbackUsed
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
