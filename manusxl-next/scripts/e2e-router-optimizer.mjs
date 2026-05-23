const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";

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

async function main() {
  console.log(`ManusXL router optimizer E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const originalConfig = await client.fetchJson("/api/config");
  const prompt = encodeURIComponent("调研中国新能源车前五，输出对比报告和建议");
  const snapshot = await client.fetchJson(`/api/model-router/optimizer?prompt=${prompt}`);

  assert(snapshot.selectedTaskType === "research", "调研类任务没有识别为 research");
  assert(snapshot.recommendation?.policy?.planning?.model, "没有返回规划模型推荐");
  assert(snapshot.recommendation.policy.planning.model === "deepseek-v4-pro", "调研类规划没有推荐强模型");
  assert(snapshot.recommendation.policy.finalAnswer.model, "没有返回总结模型推荐");
  assert(typeof snapshot.abTest?.costSavingsRate === "number", "没有返回 A/B 成本回放");
  assert(snapshot.latencyMs < 50, `路由优化接口耗时 ${snapshot.latencyMs}ms，超过 50ms`);

  try {
    const policy = snapshot.recommendation.policy;
    const patched = await client.fetchJson("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planningModel: policy.planning.model,
        executionModel: policy.execution.model,
        finalModel: policy.finalAnswer.model
      })
    });

    assert(patched.planningModel === policy.planning.model, "推荐规划模型没有立即生效");
    assert(patched.executionModel === policy.execution.model, "推荐执行模型没有立即生效");
    assert(patched.finalModel === policy.finalAnswer.model, "推荐总结模型没有立即生效");

    console.log(JSON.stringify({
      ok: true,
      selectedTaskType: snapshot.selectedTaskType,
      models: {
        planning: policy.planning.model,
        execution: policy.execution.model,
        final: policy.finalAnswer.model
      },
      abTest: snapshot.abTest
    }, null, 2));
  } finally {
    await client.fetchJson("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
