const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 120000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nearlyEqual(a, b, tolerance = 0.0000001) {
  return Math.abs(a - b) <= tolerance;
}

function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function today() {
  return new Date().toISOString().slice(0, 10);
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

  async function login() {
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
    return verified.body?.user ?? verified.user;
  }

  return { fetchJson, login };
}

async function waitForTask(client, taskId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await client.fetchJson(`/api/tasks/${taskId}`);
    if (["completed", "failed", "cancelled", "timeout"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`任务 ${taskId} 在 ${timeoutMs}ms 内没有完成`);
}

function assertBillingMatchesTask(taskMetrics, taskBilling, billing) {
  const expected = {
    totalCalls: taskMetrics.totalCalls,
    promptTokens: taskMetrics.promptTokens,
    completionTokens: taskMetrics.completionTokens,
    totalTokens: taskMetrics.totalTokens,
    estimatedCostUsd: taskMetrics.estimatedCostUsd,
    estimatedCostCny: taskMetrics.estimatedCostCny
  };

  for (const field of ["totalCalls", "promptTokens", "completionTokens", "totalTokens"]) {
    assert(taskBilling[field] === expected[field], `任务账单 ${field} 不一致`);
  }
  assert(nearlyEqual(taskBilling.estimatedCostUsd, expected.estimatedCostUsd), "任务 USD 成本不一致");
  assert(nearlyEqual(taskBilling.estimatedCostCny, expected.estimatedCostCny, 0.00001), "任务 CNY 成本不一致");

  assert(billing.totalCalls >= expected.totalCalls, "月度 totalCalls 小于任务调用数");
  assert(billing.promptTokens >= expected.promptTokens, "月度 promptTokens 小于任务输入数");
  assert(billing.byModel.length > 0, "缺少按模型账单维度");
  assert(billing.byDay.some((day) => day.name === today()), "缺少今天的按日账单维度");

  const modelUsd = sum(billing.byModel, (item) => item.estimatedCostUsd);
  const dayUsd = sum(billing.byDay, (item) => item.estimatedCostUsd);
  assert(nearlyEqual(modelUsd, billing.estimatedCostUsd), "按模型汇总与总成本不一致");
  assert(nearlyEqual(dayUsd, billing.estimatedCostUsd), "按天汇总与总成本不一致");
}

async function main() {
  console.log(`ManusXL billing E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const originalConfig = await client.fetchJson("/api/config");
  await client.fetchJson("/api/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      maxSteps: 3,
      taskBudgetUsd: 1,
      promptCacheEnabled: originalConfig.promptCacheEnabled
    })
  });

  try {
    const created = await client.fetchJson("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "计费验收：拆解一个小型 SaaS 产品调研任务，输出 3 个关键结论，并记录每步 token 成本。",
        model: originalConfig.model
      })
    });
    assert(created.taskId, "创建任务没有返回 taskId");

    const task = await waitForTask(client, created.taskId);
    assert(task.status === "completed", `任务状态不是 completed：${task.status}`);

    const metrics = await client.fetchJson(`/api/metrics/context-cache?taskId=${created.taskId}`);
    assert(metrics.totalCalls >= 2, "任务缺少 LLM 调用指标");
    assert(metrics.estimatedCostUsd > 0, "任务成本没有上涨");

    const billing = await client.fetchJson(`/api/billing?month=${currentMonth()}`);
    const taskBilling = billing.byTask.find((item) => item.taskId === created.taskId);
    assert(taskBilling, "月度账单中找不到当前任务");
    assertBillingMatchesTask(metrics, taskBilling, billing);

    console.log(JSON.stringify({
      ok: true,
      taskId: created.taskId,
      calls: metrics.totalCalls,
      usd: metrics.estimatedCostUsd,
      checked: ["task", "model", "day"]
    }, null, 2));
  } finally {
    await client.fetchJson("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxSteps: originalConfig.maxSteps,
        taskBudgetUsd: originalConfig.taskBudgetUsd,
        promptCacheEnabled: originalConfig.promptCacheEnabled,
        planningModel: originalConfig.planningModel,
        executionModel: originalConfig.executionModel,
        finalModel: originalConfig.finalModel
      })
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
