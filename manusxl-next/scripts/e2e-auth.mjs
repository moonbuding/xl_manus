const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function createClient() {
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

  return { fetchJson };
}

async function postJson(pathname, body, client = createClient(), allowError = false) {
  return client.fetchJson(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, allowError);
}

async function main() {
  console.log(`ManusXL auth E2E base URL: ${baseUrl}`);

  const anonymousTasks = await fetch(url("/api/tasks"));
  assert(anonymousTasks.status === 401, "未登录访问 /api/tasks 应返回 401");
  const oauthNotConfigured = await fetch(url("/api/auth/oauth/google/start"), { redirect: "manual" });
  assert(
    oauthNotConfigured.status === 400 || oauthNotConfigured.status === 307 || oauthNotConfigured.status === 302,
    "Google OAuth start 应在未配置时安全失败，或在已配置时重定向"
  );

  const email = `e2e-${Date.now()}@example.com`;
  const password = "password-123";
  const client = createClient();
  const registered = await postJson("/api/auth/register", {
    email,
    password,
    displayName: "E2E Auth"
  }, client);
  assert(registered.body.verificationCode, "邮箱注册没有返回本地验证码");

  const verified = await postJson("/api/auth/verify", {
    email,
    code: registered.body.verificationCode
  }, client);
  assert(verified.body.user?.email === email, "邮箱验证没有登录正确用户");
  assert(verified.body.accessToken, "邮箱验证没有返回 access token");
  assert(verified.body.refreshToken, "邮箱验证没有返回 refresh token");

  const bearerTasks = await fetch(url("/api/tasks"), {
    headers: { Authorization: `Bearer ${verified.body.accessToken}` }
  });
  assert(bearerTasks.status === 200, "Authorization Bearer access token 不能访问 /api/tasks");

  const refreshed = await postJson("/api/auth/refresh", {}, client);
  assert(refreshed.body.accessToken, "refresh 没有返回新的 access token");
  assert(refreshed.body.user?.email === email, "refresh 后用户不一致");

  await client.fetchJson("/api/auth/logout", { method: "POST" });
  const loggedOutMe = await client.fetchJson("/api/auth/me", undefined, true);
  assert(loggedOutMe.response.status === 401, "logout 后 cookie 仍可访问 /api/auth/me");

  const loginClient = createClient();
  const loggedIn = await postJson("/api/auth/login", { email, password }, loginClient);
  assert(loggedIn.body.user?.email === email, "邮箱密码登录失败");

  console.log(JSON.stringify({
    ok: true,
    email,
    checked: ["unauthorized", "email register", "email verify", "bearer token", "refresh", "logout", "email login"]
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
