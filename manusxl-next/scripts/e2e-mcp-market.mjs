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

  async function fetchJson(pathname, init, allowError = false) {
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
    if (!allowError) assert(response.ok, `${pathname} 请求失败：${response.status} ${body}`);
    return { response, body: parsed };
  }

  async function login() {
    const requested = await fetchJson("/api/auth/phone/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    assert(requested.body.verificationCode, "开发验证码没有返回");

    const verified = await fetchJson("/api/auth/phone/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code: requested.body.verificationCode })
    });
    assert(verified.body.user?.id, "手机号登录没有返回用户信息");
  }

  return { fetchJson, login };
}

async function main() {
  console.log(`ManusXL MCP market E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const catalogResult = await client.fetchJson("/api/mcp/catalog");
  const catalog = catalogResult.body.catalog ?? [];
  assert(catalog.length >= 5, "MCP 市场预设数量不足");
  assert(catalog.some((item) => item.id === "github"), "缺少 GitHub MCP 预设");
  assert(catalog.some((item) => item.id === "filesystem"), "缺少 Filesystem MCP 预设");
  assert(catalog.every((item) => item.safetyNote), "MCP 预设缺少安全提示");

  const mock = catalog.find((item) => item.id === "mock-stdio");
  assert(mock, "缺少本地 mock MCP 预设");

  const created = await client.fetchJson("/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: mock.name,
      type: mock.type,
      command: mock.command,
      args: mock.args,
      env: {}
    })
  });
  const server = created.body.server;
  assert(server?.id, "从 MCP 市场预设创建 server 失败");
  assert(server.status === "healthy", `market mock MCP 状态异常：${server.statusMessage}`);
  assert(server.tools.includes("echo_context"), "market mock MCP 没有发现 echo_context");

  const invalid = await client.fetchJson("/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "unsafe command",
      type: "stdio",
      command: "bash",
      args: ["-lc", "echo unsafe"],
      env: {}
    })
  }, true);
  assert(invalid.response.status === 400, "不在 allowlist 的 command 应被拒绝");

  await client.fetchJson("/api/mcp", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId: server.id })
  });

  console.log(JSON.stringify({
    ok: true,
    catalog: catalog.map((item) => item.id),
    createdFromPreset: server.name
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
