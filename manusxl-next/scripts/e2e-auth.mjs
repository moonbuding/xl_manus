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
  const anonymousAuthStatus = await fetch(url("/api/auth/status"));
  assert(anonymousAuthStatus.status === 401, "未登录访问 /api/auth/status 应返回 401");
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
  assert(
    ["development", "smtp"].includes(registered.body.emailDelivery?.mode),
    "邮箱注册没有返回邮件投递模式"
  );

  const verified = await postJson("/api/auth/verify", {
    email,
    code: registered.body.verificationCode
  }, client);
  assert(verified.body.user?.email === email, "邮箱验证没有登录正确用户");
  assert(verified.body.accessToken, "邮箱验证没有返回 access token");
  assert(verified.body.refreshToken, "邮箱验证没有返回 refresh token");

  const authStatus = await client.fetchJson("/api/auth/status");
  assert(["development", "smtp"].includes(authStatus.body.email?.mode), "认证状态缺少邮箱投递模式");
  assert(Array.isArray(authStatus.body.oauth), "认证状态缺少 OAuth providers");
  assert(authStatus.body.oauth.length >= 2, "认证状态 OAuth providers 数量不足");
  assert(
    authStatus.body.oauth.every((provider) => provider.callbackUrl?.includes(`/api/auth/oauth/${provider.provider}/callback`)),
    "认证状态 OAuth callback URL 不正确"
  );
  assert(authStatus.body.session?.accessMaxAgeSeconds > 0, "认证状态缺少 session access TTL");

  const bearerTasks = await fetch(url("/api/tasks"), {
    headers: { Authorization: `Bearer ${verified.body.accessToken}` }
  });
  assert(bearerTasks.status === 200, "Authorization Bearer access token 不能访问 /api/tasks");

  const refreshed = await postJson("/api/auth/refresh", {}, client);
  assert(refreshed.body.accessToken, "refresh 没有返回新的 access token");
  assert(refreshed.body.refreshToken, "refresh 没有返回新的 refresh token");
  assert(refreshed.body.user?.email === email, "refresh 后用户不一致");

  const oldRefreshRejected = await fetch(url("/api/auth/refresh"), {
    method: "POST",
    headers: { Cookie: `manusxl_refresh=${verified.body.refreshToken}` }
  });
  assert(oldRefreshRejected.status === 401, "旧 refresh token 在轮换后仍可续期");

  await client.fetchJson("/api/auth/logout", { method: "POST" });
  const loggedOutMe = await client.fetchJson("/api/auth/me", undefined, true);
  assert(loggedOutMe.response.status === 401, "logout 后 cookie 仍可访问 /api/auth/me");
  const logoutRefreshRejected = await fetch(url("/api/auth/refresh"), {
    method: "POST",
    headers: { Cookie: `manusxl_refresh=${refreshed.body.refreshToken}` }
  });
  assert(logoutRefreshRejected.status === 401, "logout 后 refresh token 仍可续期");

  const loginClient = createClient();
  const loggedIn = await postJson("/api/auth/login", { email, password }, loginClient);
  assert(loggedIn.body.user?.email === email, "邮箱密码登录失败");

  console.log(JSON.stringify({
    ok: true,
    email,
    checked: [
      "unauthorized",
      "email register",
      "email delivery",
      "email verify",
      "auth status",
      "bearer token",
      "refresh rotation",
      "logout revocation",
      "email login"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
