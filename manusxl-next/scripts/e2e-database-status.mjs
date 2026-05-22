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
  console.log(`ManusXL database status E2E base URL: ${baseUrl}`);

  const anonymous = await fetch(url("/api/database/status"));
  assert(anonymous.status === 401, "未登录访问数据库状态应返回 401");

  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const status = (await client.fetchJson("/api/database/status")).body;
  assert(["sqlite", "postgres"].includes(status.requestedProvider), "requestedProvider 不合法");
  assert(status.activeProvider === "sqlite", "当前运行时应仍使用 SQLite");
  assert(status.sqlite?.exists === true, "SQLite 文件未被识别");
  assert(Array.isArray(status.sqlite.tables), "SQLite 表统计没有返回");
  assert(status.sqlite.tables.length >= 10, "SQLite 表统计不完整");
  assert(status.sqlite.totalRows >= 0, "SQLite 总行数不合法");
  assert(status.postgres?.expectedTableCount >= 10, "PostgreSQL 预期表数不合法");
  assert(status.commands?.dryRun === "npm run db:pg:dry-run", "迁移命令没有返回");

  const checked = (await client.fetchJson("/api/database/status?check=1")).body;
  assert(checked.postgres, "PostgreSQL 检查块没有返回");
  assert(typeof checked.postgres.cliAvailable === "boolean", "psql CLI 状态不合法");

  console.log(JSON.stringify({
    ok: true,
    provider: status.requestedProvider,
    activeProvider: status.activeProvider,
    sqliteRows: status.sqlite.totalRows,
    postgresCliAvailable: checked.postgres.cliAvailable,
    postgresSchemaReady: checked.postgres.schemaReady ?? null
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
