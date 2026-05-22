const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 180000);
const minCachedInputSavingsRate = Number(process.env.MANUSXL_E2E_PROMPT_CACHE_MIN_SAVINGS_RATE ?? 0.7);
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

async function patchConfig(config) {
  return fetchJson("/api/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
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

async function createAndWait(prompt, model) {
  const created = await fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model })
  });
  assert(created.taskId, "创建任务没有返回 taskId");
  console.log(`任务已创建：${created.taskId}`);
  await waitForTask(created.taskId);
  const task = await fetchJson(`/api/tasks/${created.taskId}`);
  assert(task.status === "completed", `任务状态不是 completed：${task.status}`);
  return created.taskId;
}

async function cacheMetrics(taskId) {
  return fetchJson(`/api/metrics/context-cache?taskId=${encodeURIComponent(taskId)}`);
}

function followupHitRate(metrics) {
  const cached = metrics.filter((metric) => metric.cacheReadTokens > 0);
  const promptTokens = cached.reduce((sum, metric) => sum + metric.promptTokens, 0);
  const cacheReadTokens = cached.reduce((sum, metric) => sum + metric.cacheReadTokens, 0);
  return promptTokens > 0 ? cacheReadTokens / promptTokens : 0;
}

function cachedInputSavingsRate(model) {
  const key = String(model ?? "").toLowerCase();
  const input =
    key.includes("deepseek")
      ? Number(process.env.MANUSXL_DEEPSEEK_INPUT_USD_PER_1M ?? 0.07)
      : Number(process.env.MANUSXL_DEFAULT_INPUT_USD_PER_1M ?? 0.1);
  const cache =
    key.includes("deepseek")
      ? Number(process.env.MANUSXL_DEEPSEEK_CACHE_USD_PER_1M ?? 0.014)
      : Number(process.env.MANUSXL_DEFAULT_CACHE_USD_PER_1M ?? 0.02);
  return input > 0 ? Math.max(0, (input - cache) / input) : 0;
}

function assertTaskCache(summary, label, model) {
  const metrics = summary.metrics ?? [];
  const planMetric = metrics.find((metric) => metric.stage === "plan");
  assert(planMetric, `${label} 缺少 plan 指标`);
  assert(planMetric.cacheReadTokens === 0, `${label} 首次 plan 调用不应读取 cache`);
  assert(!planMetric.stablePrefixReused, `${label} 首次 plan 调用不应标记为复用稳定前缀`);
  assert(summary.stablePrefixHits >= 1, `${label} 第 2 次以后 LLM 调用没有命中稳定前缀 cache`);
  assert(
    metrics.some((metric) => metric.cacheReadTokens > 0 && metric.stablePrefixReused),
    `${label} 没有任何后续调用读取 cache`
  );

  const hitRate = followupHitRate(metrics);
  const savingsRate = cachedInputSavingsRate(model);
  assert(
    savingsRate >= minCachedInputSavingsRate,
    `${label} 缓存输入 token 成本节省率 ${(savingsRate * 100).toFixed(1)}%，低于 ${(minCachedInputSavingsRate * 100).toFixed(0)}%`
  );
  return { hitRate, savingsRate };
}

async function main() {
  console.log(`ManusXL prompt cache E2E base URL: ${baseUrl}`);
  await loginForE2E();
  const originalConfig = await fetchJson("/api/config");

  try {
    const config = await patchConfig({
      promptCacheEnabled: true,
      maxSteps: 3,
      model: originalConfig.model,
      baseUrl: originalConfig.baseUrl,
      temperature: originalConfig.temperature,
      taskBudgetUsd: originalConfig.taskBudgetUsd,
      planningModel: originalConfig.planningModel,
      executionModel: originalConfig.executionModel,
      finalModel: originalConfig.finalModel
    });
    const prompt = [
      "请只用 1 个极短执行步骤验收 ManusXL Prompt Cache。",
      "上下文需覆盖 web research、MCP、上传 PDF/Excel/图片 OCR、Skill、Python/Shell、Dashboard 图表、地图路线和报告交付这些能力名称，",
      "但最终只输出一句中文结论，便于验证长 system prompt 和工具描述尾部的缓存节省。"
    ].join("");

    const firstTaskId = await createAndWait(prompt, config.model);
    const firstSummary = await cacheMetrics(firstTaskId);
    const firstCache = assertTaskCache(firstSummary, "任务一", config.model);

    const secondTaskId = await createAndWait(prompt, config.model);
    const secondSummary = await cacheMetrics(secondTaskId);
    const secondCache = assertTaskCache(secondSummary, "任务二", config.model);
    const secondPlan = (secondSummary.metrics ?? []).find((metric) => metric.stage === "plan");
    assert(secondPlan?.cacheReadTokens === 0, "任务二 plan 出现 cache read，说明不同 task 之间可能串 cache");

    console.log(
      `Prompt Cache E2E 通过：任务一后续命中率 ${(firstCache.hitRate * 100).toFixed(1)}%、缓存输入成本节省 ${(firstCache.savingsRate * 100).toFixed(1)}%；任务二后续命中率 ${(secondCache.hitRate * 100).toFixed(1)}%、缓存输入成本节省 ${(secondCache.savingsRate * 100).toFixed(1)}%；跨任务 plan 未复用 cache。`
    );
  } finally {
    await patchConfig({
      promptCacheEnabled: originalConfig.promptCacheEnabled,
      maxSteps: originalConfig.maxSteps,
      model: originalConfig.model,
      baseUrl: originalConfig.baseUrl,
      temperature: originalConfig.temperature,
      taskBudgetUsd: originalConfig.taskBudgetUsd,
      planningModel: originalConfig.planningModel,
      executionModel: originalConfig.executionModel,
      finalModel: originalConfig.finalModel
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
