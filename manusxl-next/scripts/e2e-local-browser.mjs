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

  function rememberCookies(headers) {
    const raw = headers.get("set-cookie");
    if (!raw) return;
    raw
      .split(/,\s*(?=[^;]+=)/)
      .map((cookie) => cookie.split(";")[0])
      .filter(Boolean)
      .forEach((cookie) => {
        const separator = cookie.indexOf("=");
        if (separator > 0) cookieJar.set(cookie.slice(0, separator), cookie.slice(separator + 1));
      });
  }

  async function fetchJson(pathname, init = {}, allowError = false) {
    const headers = new Headers(init.headers);
    const cookies = cookieHeader();
    if (cookies) headers.set("Cookie", cookies);
    const response = await fetch(url(pathname), { ...init, headers });
    rememberCookies(response.headers);
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!allowError) assert(response.ok, `${pathname} 请求失败：${response.status} ${text}`);
    return { response, body };
  }

  async function login() {
    const requested = await fetchJson("/api/auth/phone/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    await fetchJson("/api/auth/phone/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code: requested.body.verificationCode })
    });
  }

  return { fetchJson, login };
}

async function main() {
  console.log(`ManusXL local browser E2E base URL: ${baseUrl}`);
  const anonymous = await fetch(url("/api/local-browser/status"));
  assert(anonymous.status === 401, "本地浏览器状态接口未登录应返回 401");

  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const invalid = await client.fetchJson(
    "/api/local-browser/status",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "http://example.com:9222" })
    }
  );
  assert(invalid.body.connected === false, "非 localhost CDP 地址不应通过");
  assert(invalid.body.error?.includes("localhost"), "非法 CDP 地址缺少安全提示");

  const status = await client.fetchJson("/api/local-browser/status");
  assert(typeof status.body.connected === "boolean", "本地浏览器状态缺少 connected 字段");
  assert(status.body.endpoint, "本地浏览器状态缺少 endpoint");

  console.log(JSON.stringify({
    ok: true,
    endpoint: status.body.endpoint,
    connected: status.body.connected,
    checked: ["auth guard", "localhost guard", "cdp status"]
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
