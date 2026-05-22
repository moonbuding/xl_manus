const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 120000);

const modelPrices = {
  "deepseek-v4-pro": { input: 1, output: 3, cache: 0.2 },
  "deepseek-v4-flash": { input: 0.07, output: 0.27, cache: 0.014 },
  "deepseek-v4-mini": { input: 0.03, output: 0.12, cache: 0.006 },
  "deepseek-chat": { input: 0.07, output: 0.27, cache: 0.014 }
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function estimateCost(model, metric) {
  const price = modelPrices[model] ?? { input: 0.1, output: 0.3, cache: 0.02 };
  const cacheReadTokens = metric.cacheReadTokens ?? 0;
  const paidInputTokens = Math.max(0, metric.promptTokens - cacheReadTokens);
  return (
    (paidInputTokens / 1_000_000) * price.input +
    (cacheReadTokens / 1_000_000) * price.cache +
    (metric.completionTokens / 1_000_000) * price.output
  );
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

function routeEvent(task) {
  return task.events.find((event) => event.title === "模型路由");
}

async function main() {
  console.log(`ManusXL model router E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const originalConfig = await client.fetchJson("/api/config");
  await client.fetchJson("/api/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      maxSteps: 3,
      taskBudgetUsd: 1,
      planningModel: "deepseek-v4-pro",
      executionModel: "deepseek-v4-mini",
      finalModel: "deepseek-v4-flash",
      promptCacheEnabled: originalConfig.promptCacheEnabled
    })
  });

  try {
    const patched = await client.fetchJson("/api/config");
    assert(patched.planningModel === "deepseek-v4-pro", "规划模型配置没有立即生效");
    assert(patched.executionModel === "deepseek-v4-mini", "执行模型配置没有立即生效");
    assert(patched.finalModel === "deepseek-v4-flash", "总结模型配置没有立即生效");

    const created = await client.fetchJson("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "多模型调度验收：规划一个复杂调研任务，执行步骤保持轻量，最后输出简短总结。",
        model: originalConfig.model
      })
    });
    assert(created.taskId, "创建任务没有返回 taskId");

    const task = await waitForTask(client, created.taskId);
    assert(task.status === "completed", `任务状态不是 completed：${task.status}`);

    const route = routeEvent(task);
    assert(route?.payload?.modelRoutes?.planning?.model === "deepseek-v4-pro", "事件流没有记录规划模型");
    assert(route?.payload?.modelRoutes?.execution?.model === "deepseek-v4-mini", "事件流没有记录执行模型");
    assert(route?.payload?.modelRoutes?.finalAnswer?.model === "deepseek-v4-flash", "事件流没有记录总结模型");

    const metrics = await client.fetchJson(`/api/metrics/context-cache?taskId=${created.taskId}`);
    const metricRows = metrics.metrics ?? [];
    assert(metricRows.some((metric) => metric.stage === "plan" && metric.model === "deepseek-v4-pro"), "plan 指标没有使用规划模型");
    assert(
      metricRows.some((metric) => metric.stage === "final_answer" && metric.model === "deepseek-v4-flash"),
      "final_answer 指标没有使用总结模型"
    );

    const actualCost = metricRows.reduce((total, metric) => total + metric.estimatedCostUsd, 0);
    const allProCost = metricRows.reduce(
      (total, metric) => total + estimateCost("deepseek-v4-pro", metric),
      0
    );
    const savingsRate = allProCost > 0 ? (allProCost - actualCost) / allProCost : 0;
    assert(savingsRate >= 0.3, `混合路由成本下降 ${(savingsRate * 100).toFixed(1)}%，低于 30%`);

    console.log(JSON.stringify({
      ok: true,
      taskId: created.taskId,
      models: {
        planning: "deepseek-v4-pro",
        execution: "deepseek-v4-mini",
        final: "deepseek-v4-flash"
      },
      savingsRate: Number(savingsRate.toFixed(4))
    }, null, 2));
  } finally {
    await client.fetchJson("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxSteps: originalConfig.maxSteps,
        taskBudgetUsd: originalConfig.taskBudgetUsd,
        planningModel: originalConfig.planningModel,
        executionModel: originalConfig.executionModel,
        finalModel: originalConfig.finalModel,
        promptCacheEnabled: originalConfig.promptCacheEnabled
      })
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
