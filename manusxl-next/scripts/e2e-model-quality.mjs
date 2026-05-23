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
  console.log(`ManusXL model quality E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const result = await client.fetchJson("/api/diagnostics/model-quality", { method: "POST" });
  assert(result.fixtureCount === 10, "模型质量评估没有覆盖 10 个任务");
  assert(result.passed, "混合模型质量/成本评估未通过");
  assert(result.mixedAverageScore >= result.highAverageScore, "混合模型平均质量分低于全高配模型");
  assert(result.costSavingsRate >= 0.3, "混合模型成本下降低于 30%");
  assert(result.manualReviewRubric?.length >= 4, "缺少人工复核 rubric");
  assert(
    result.mixed.every((item) => item.routes?.planning?.model && item.routes?.finalAnswer?.model),
    "评估结果缺少路由细节"
  );

  console.log(JSON.stringify({
    ok: true,
    fixtureCount: result.fixtureCount,
    highAverageScore: result.highAverageScore,
    mixedAverageScore: result.mixedAverageScore,
    costSavingsRate: result.costSavingsRate
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
