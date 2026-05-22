const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const taskCount = Number(process.env.MANUSXL_E2E_ACL_TASKS ?? 10);
const maxAverageMs = Number(process.env.MANUSXL_E2E_ACL_MAX_AVG_MS ?? 50);

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

  async function request(pathname, init, allowError = false) {
    const response = await fetch(url(pathname), {
      ...init,
      headers: mergeHeaders(init?.headers)
    });
    rememberCookies(response.headers);
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!allowError) assert(response.ok, `${pathname} 请求失败：${response.status} ${text}`);
    return { response, body };
  }

  async function login() {
    const requested = await request("/api/auth/phone/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    assert(requested.body.verificationCode, "开发验证码没有返回");

    const verified = await request("/api/auth/phone/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code: requested.body.verificationCode })
    });
    assert(verified.body.user?.id, "手机号登录没有返回用户信息");
    return verified.body.user;
  }

  return { login, request };
}

async function createTask(client, index) {
  const config = await client.request("/api/config");
  const created = await client.request("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `ACL 并发验收测试任务 ${index}：只需要保持任务记录用于权限检查。`,
      model: config.body.model
    })
  });
  assert(created.body.taskId, "创建任务没有返回 taskId");
  return created.body.taskId;
}

async function cancelTask(client, taskId) {
  await client.request(`/api/tasks/${taskId}/cancel`, { method: "POST" }, true);
}

async function main() {
  console.log(`ManusXL ACL concurrency E2E base URL: ${baseUrl}`);
  const userA = createClient("18800000001");
  const userB = createClient("18800000002");
  await userA.login();
  await userB.login();

  const taskIds = [];
  for (let index = 0; index < taskCount; index += 1) {
    taskIds.push(await createTask(userA, index + 1));
  }
  const otherTaskId = await createTask(userB, 1);
  await Promise.all([...taskIds.map((taskId) => cancelTask(userA, taskId)), cancelTask(userB, otherTaskId)]);

  await userA.request("/api/tasks");
  await userA.request(`/api/tasks/${taskIds[0]}`);

  const started = performance.now();
  const results = await Promise.all([
    ...taskIds.map((taskId) => userA.request(`/api/tasks/${taskId}`)),
    ...taskIds.map((taskId) => userB.request(`/api/tasks/${taskId}`, undefined, true))
  ]);
  const durationMs = performance.now() - started;
  const averageMs = durationMs / results.length;

  const ownResults = results.slice(0, taskIds.length);
  const crossResults = results.slice(taskIds.length);
  assert(ownResults.every((result) => result.response.status === 200), "本人任务详情存在不可读结果");
  assert(crossResults.every((result) => result.response.status === 404), "跨用户任务详情没有被 ACL 拦截");

  const userAList = await userA.request("/api/tasks");
  const userATaskIds = new Set((userAList.body.tasks ?? []).map((task) => task.id));
  assert(!userATaskIds.has(otherTaskId), "用户 A 的任务列表中出现了用户 B 的任务");
  assert(averageMs <= maxAverageMs, `ACL 并发读取平均 ${averageMs.toFixed(1)}ms，超过 ${maxAverageMs}ms`);

  console.log(
    `ACL 并发 E2E 通过：${taskCount} 个任务本人可读、跨用户 404，${results.length} 次并发详情读取平均 ${averageMs.toFixed(1)}ms。`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
