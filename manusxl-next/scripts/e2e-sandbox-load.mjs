const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const taskCount = Number(process.env.MANUSXL_E2E_SANDBOX_LOAD_TASKS ?? 50);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function createClient(phone) {
  const cookieJar = new Map();

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
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = text;
    }
    if (!allowError) assert(response.ok, `${pathname} 请求失败：${response.status} ${text}`);
    return { response, body };
  }

  async function login() {
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
  }

  return { fetchJson, login };
}

async function settleScheduler(client, expectedQueueLength = 0) {
  const deadline = Date.now() + 15_000;
  let latest;
  while (Date.now() < deadline) {
    latest = await client.fetchJson("/api/tasks/scheduler");
    const queueLength = latest.body.queue?.length ?? 0;
    if (queueLength <= expectedQueueLength) return latest.body;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return latest?.body;
}

async function main() {
  console.log(`ManusXL sandbox load E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const created = await Promise.all(
    Array.from({ length: taskCount }, (_, index) =>
      client.fetchJson("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `沙盒并发压测 ${index + 1}/${taskCount}：保持排队与取消链路稳定，输出一句话即可。`
        })
      })
    )
  );
  const taskIds = created.map((item) => item.body.taskId).filter(Boolean);
  assert(taskIds.length === taskCount, `只创建了 ${taskIds.length}/${taskCount} 个任务`);

  const snapshot = (await client.fetchJson("/api/tasks/scheduler")).body;
  const runningCount = snapshot.running?.length ?? 0;
  const queueLength = snapshot.queue?.length ?? 0;
  const maxOwnerRunning = Math.max(
    0,
    ...Object.values(snapshot.runningByOwner ?? {}).map((items) => items.length)
  );

  assert(runningCount <= snapshot.limits.total, "运行任务数超过全局上限");
  assert(maxOwnerRunning <= snapshot.limits.perUser, "单用户运行任务数超过上限");
  assert(runningCount + queueLength <= taskCount, "调度队列出现重复或幽灵任务");
  assert(runningCount + queueLength >= Math.min(taskCount, snapshot.limits.total), "调度器没有接住并发任务");

  await Promise.all(
    taskIds.map((taskId) =>
      client.fetchJson(`/api/tasks/${taskId}/cancel`, { method: "POST" }, true)
    )
  );
  const afterCancel = await settleScheduler(client, 0);
  assert(afterCancel, "取消后没有拿到调度器状态");
  assert((afterCancel.queue?.length ?? 0) === 0, "取消后调度队列仍有残留任务");
  assert((afterCancel.running?.length ?? 0) <= snapshot.limits.total, "取消后运行集合超过上限");

  const details = await Promise.all(taskIds.slice(0, 8).map((taskId) => client.fetchJson(`/api/tasks/${taskId}`)));
  assert(
    details.every((item) => ["cancelled", "completed"].includes(item.body.status)),
    "取消后的任务没有进入稳定终态"
  );

  console.log(JSON.stringify({
    ok: true,
    created: taskIds.length,
    initialRunning: runningCount,
    initialQueued: queueLength,
    maxOwnerRunning,
    queueAfterCancel: afterCancel.queue.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
