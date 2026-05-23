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
  console.log(`ManusXL fallback benchmark E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const result = await client.fetchJson("/api/diagnostics/fallback-benchmark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ iterations: 100 })
  });

  assert(result.iterations === 100, "没有跑满 100 个工具任务样本");
  assert(result.baselineFailureRate === 1, "基线失败率应为 100%");
  assert(result.fallbackFailureRate === 0, "fallback 后失败率应为 0%");
  assert(result.failureRateReduction >= 0.2, "失败率下降不足 20%");
  assert(result.fallbackUsed === 100, "100 个样本都应该使用 fallback");
  assert(result.sampleAttempts?.[0]?.attempts?.length >= 2, "事件尝试记录不可见");
  assert(result.allFailed?.ok === false, "全链失败场景应失败");
  assert(result.allFailed?.observation?.includes("请考虑换路径"), "全链失败缺少回流提示");

  console.log(JSON.stringify({
    ok: true,
    iterations: result.iterations,
    baselineFailureRate: result.baselineFailureRate,
    fallbackFailureRate: result.fallbackFailureRate,
    failureRateReduction: result.failureRateReduction,
    allFailedAttempts: result.allFailed.attempts.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
