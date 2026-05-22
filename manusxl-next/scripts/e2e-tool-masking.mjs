const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 180000);
const phone = process.env.MANUSXL_E2E_PHONE ?? "18800000001";
const minReduction = Number(process.env.MANUSXL_E2E_TOOL_MASK_MIN_REDUCTION ?? 0.3);
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

async function main() {
  console.log(`ManusXL tool masking E2E base URL: ${baseUrl}`);
  await loginForE2E();

  const config = await fetchJson("/api/config");
  const created = await fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "把这句话翻译成英文：今天我们把 ManusXL 的工具动态启用功能做完整验收。",
      model: config.model
    })
  });
  assert(created.taskId, "创建任务没有返回 taskId");
  console.log(`任务已创建：${created.taskId}`);

  const events = await waitForTask(created.taskId);
  const maskingEvent = events.find(
    (event) => event.type === "message" && event.title === "工具动态启用"
  );
  assert(maskingEvent, "缺少工具动态启用事件");

  const masking = maskingEvent.payload?.toolMasking;
  assert(masking, "缺少工具 masking 指标");
  assert(
    masking.tokenReductionPercent >= minReduction,
    `工具描述 token 降幅 ${(masking.tokenReductionPercent * 100).toFixed(1)}%，低于 ${(minReduction * 100).toFixed(0)}%`
  );
  assert(masking.enabledToolCount < masking.allToolCount, "本任务没有减少工具数量");

  console.log(
    `工具动态启用 E2E 通过：启用 ${masking.enabledToolCount}/${masking.allToolCount} 个工具，描述 token 预计下降 ${(masking.tokenReductionPercent * 100).toFixed(1)}%。`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
