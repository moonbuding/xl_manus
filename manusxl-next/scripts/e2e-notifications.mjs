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
    return verified.body.user;
  }

  return { fetchJson, login };
}

async function patchSettings(client, patch) {
  return (await client.fetchJson("/api/notifications/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  })).body.settings;
}

async function logs(client) {
  return (await client.fetchJson("/api/notifications/logs?limit=20")).body.logs ?? [];
}

async function main() {
  console.log(`ManusXL notifications E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const initial = (await client.fetchJson("/api/notifications/settings")).body;
  assert(initial.settings.emailEnabled === false, "默认不应启用 Email 通知");
  assert(initial.settings.notifyOnCompleted === true, "默认应监听完成通知");

  const enabled = await patchSettings(client, {
    emailEnabled: true,
    webhookEnabled: false,
    slackEnabled: false,
    notifyOnCompleted: true,
    notifyOnFailed: true
  });
  assert(enabled.emailEnabled === true, "Email 通知开关保存失败");

  const testCompleted = await client.fetchJson("/api/notifications/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "completed" })
  });
  assert(testCompleted.body.logs?.[0]?.channel === "email", "完成通知没有走 Email 渠道");
  assert(
    ["development", "sent"].includes(testCompleted.body.logs?.[0]?.status),
    "完成通知没有记录开发/发送状态"
  );

  const afterCompleted = await logs(client);
  assert(
    afterCompleted.some((log) => log.channel === "email" && log.title.includes("已完成")),
    "通知日志里找不到完成通知"
  );

  const disabled = await patchSettings(client, { notifyOnCompleted: false });
  assert(disabled.notifyOnCompleted === false, "关闭完成通知失败");
  const beforeDisabledTest = (await logs(client)).length;
  const skipped = await client.fetchJson("/api/notifications/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "completed" })
  });
  assert((skipped.body.logs ?? []).length === 0, "关闭完成通知后不应产生发送记录");
  assert((await logs(client)).length === beforeDisabledTest, "关闭完成通知后日志数量不应增加");

  await patchSettings(client, { notifyOnCompleted: true });
  const failed = await client.fetchJson("/api/notifications/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "failed" })
  });
  assert(failed.body.logs?.[0]?.title.includes("失败"), "失败通知标题不正确");

  console.log(JSON.stringify({
    ok: true,
    emailStatus: testCompleted.body.logs[0].status,
    logCount: (await logs(client)).length
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
