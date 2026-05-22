const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const taskCount = Number(process.env.MANUSXL_E2E_EVENT_BATCH_TASKS ?? 10);
const maxAverageQueueMs = Number(process.env.MANUSXL_E2E_EVENT_BATCH_MAX_AVG_MS ?? 50);
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

async function fetchJson(pathname, init, allowError = false) {
  const response = await fetch(url(pathname), {
    ...init,
    headers: mergeHeaders(init?.headers)
  });
  rememberCookies(response.headers);
  const body = await response.text();
  const parsed = JSON.parse(body);
  if (!allowError) assert(response.ok, `${pathname} 请求失败：${response.status} ${body}`);
  return { response, body: parsed };
}

async function loginForE2E() {
  const requested = await fetchJson("/api/auth/phone/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
  assert(requested.body.verificationCode, "开发验证码没有返回");

  const verified = await fetchJson("/api/auth/phone/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code: requested.body.verificationCode })
  });
  assert(verified.body.user?.id, "手机号登录没有返回用户信息");
  console.log(`已登录 E2E 用户：${verified.body.user.phone ?? phone}`);
}

async function schedulerSnapshot() {
  return (await fetchJson("/api/tasks/scheduler")).body;
}

async function createTask(index) {
  const config = await fetchJson("/api/config");
  const created = await fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `事件批量写入验收任务 ${index}：创建后立即取消，用于生成事件写入压力。`,
      model: config.body.model
    })
  });
  assert(created.body.taskId, "创建任务没有返回 taskId");
  return created.body.taskId;
}

async function cancelTask(taskId) {
  await fetchJson(`/api/tasks/${taskId}/cancel`, { method: "POST" }, true);
}

function delta(after, before, field) {
  return (after.eventPersistence?.[field] ?? 0) - (before.eventPersistence?.[field] ?? 0);
}

async function main() {
  console.log(`ManusXL event batch E2E base URL: ${baseUrl}`);
  await loginForE2E();
  await schedulerSnapshot();

  const before = await schedulerSnapshot();
  const taskIds = [];
  for (let index = 0; index < taskCount; index += 1) {
    taskIds.push(await createTask(index + 1));
  }
  await Promise.all(taskIds.map(cancelTask));
  const after = await schedulerSnapshot();

  const queueCalls = delta(after, before, "queueCalls");
  const queueDurationMsTotal = delta(after, before, "queueDurationMsTotal");
  const flushes = delta(after, before, "flushes");
  const flushedEvents = delta(after, before, "flushedEvents");
  const averageQueueMs = queueCalls > 0 ? queueDurationMsTotal / queueCalls : 0;

  assert(queueCalls >= taskCount, `事件入队次数不足：${queueCalls}/${taskCount}`);
  assert(flushes > 0, "事件批量写入没有触发 flush");
  assert(flushedEvents >= taskCount, `落盘事件数量不足：${flushedEvents}/${taskCount}`);
  assert(
    averageQueueMs <= maxAverageQueueMs,
    `事件写入路径平均 ${averageQueueMs.toFixed(2)}ms，超过 ${maxAverageQueueMs}ms`
  );

  console.log(
    `事件批量写入 E2E 通过：${queueCalls} 次事件入队、${flushedEvents} 条事件落盘、${flushes} 次 flush，平均写入路径 ${averageQueueMs.toFixed(2)}ms。`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
