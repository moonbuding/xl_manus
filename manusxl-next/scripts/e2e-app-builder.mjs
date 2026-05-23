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

async function main() {
  console.log(`ManusXL AI Slides + Web App Builder E2E base URL: ${baseUrl}`);
  await loginForE2E();

  const slideRun = await runTask("做 5 页投资人 BP，主题是 ManusXL 企业 Agent 平台，输出可用 PPTX，含配图和讲稿。");
  assert(
    slideRun.events.some((event) => event.type === "tool_call" && event.title === "slide_deck_builder"),
    "没有调用 slide_deck_builder"
  );
  const pptx = await fetchBuffer(artifactByName(slideRun.task, "ai-slides-deck.pptx").url);
  assert(bufferIncludes(pptx, "ppt/slides/slide5.xml"), "AI Slides PPTX 不足 5 页");
  assert(bufferIncludes(pptx, "ppt/media/cover-visual.svg"), "AI Slides PPTX 缺少配图素材");
  const manifest = JSON.parse(
    (await fetchBuffer(artifactByName(slideRun.task, "ai-slides-manifest.json").url)).toString("utf8")
  );
  assert(manifest.templateLibrarySize >= 10, "AI Slides 模板数量不足");

  const appRun = await runTask("做一个 todo 应用带登录，使用 Next.js + TypeScript，输出可访问预览 URL、源码包、PostgreSQL schema 和部署失败重试说明。");
  assert(
    appRun.events.some((event) => event.type === "tool_call" && event.title === "web_app_builder"),
    "没有调用 web_app_builder"
  );
  const preview = (await fetchBuffer(artifactByName(appRun.task, "web-app-preview.html").url)).toString("utf8");
  assert(/<html/i.test(preview) && /登录预览|Generated by ManusXL/.test(preview), "Web App 预览不可读");
  const sourceZip = await fetchBuffer(artifactByName(appRun.task, "web-app-source.zip").url);
  assert(bufferIncludes(sourceZip, "app/page.tsx"), "源码包缺少 app/page.tsx");
  assert(bufferIncludes(sourceZip, "db/schema.sql"), "源码包缺少数据库 schema");
  const deploy = JSON.parse(
    (await fetchBuffer(artifactByName(appRun.task, "web-app-deploy-manifest.json").url)).toString("utf8")
  );
  assert(deploy.preview.status === "ready", "Web App 预览状态不正确");
  assert(deploy.externalDeploy.retry, "部署失败重试说明缺失");

  console.log(
    JSON.stringify(
      {
        ok: true,
        slideTaskId: slideRun.taskId,
        appTaskId: appRun.taskId,
        slideTemplateCount: manifest.templateLibrarySize,
        appGeneratedFiles: deploy.generatedFiles.length,
        deployStatus: deploy.externalDeploy.status
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
