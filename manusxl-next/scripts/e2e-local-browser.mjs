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

  const tabs = await client.fetchJson("/api/local-browser/tabs");
  assert(Array.isArray(tabs.body.tabs), "本地浏览器 tabs 接口没有返回数组");
  assert(typeof tabs.body.status?.connected === "boolean", "本地浏览器 tabs 接口缺少状态");

  const previousConfig = await client.fetchJson("/api/config");
  const previousAllowlist = previousConfig.body.localBrowserDomainAllowlist ?? [];
  const previousSafety = await client.fetchJson("/api/local-browser/safety");
  const previousPaused = Boolean(previousSafety.body.paused);
  const pairing = await client.fetchJson("/api/local-browser/pairing", { method: "POST" });
  assert(pairing.body.activeCode?.code, "本地浏览器扩展配对码未生成");
  const verifiedPairing = await fetch(url("/api/local-browser/pairing/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: pairing.body.activeCode.code,
      deviceName: "E2E Chrome Extension",
      extensionId: "e2e-extension"
    })
  });
  const verifiedPairingBody = await verifiedPairing.json();
  assert(verifiedPairing.ok, "本地浏览器扩展配对验证失败");
  assert(verifiedPairingBody.paired === true, "本地浏览器扩展配对未成功");
  assert(verifiedPairingBody.token, "本地浏览器扩展配对未返回 token");
  const extensionStatus = await fetch(url("/api/local-browser/extension/status"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verifiedPairingBody.token })
  });
  const extensionStatusBody = await extensionStatus.json();
  assert(extensionStatus.ok, "本地浏览器扩展状态接口失败");
  assert(extensionStatusBody.paired === true, "本地浏览器扩展状态未识别配对 token");
  assert(
    Array.isArray(extensionStatusBody.safety?.pendingApprovals),
    "本地浏览器扩展状态缺少 pendingApprovals"
  );
  const missingApproval = await fetch(url("/api/local-browser/extension/approval"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: verifiedPairingBody.token,
      approvalId: "lbap_missing",
      approved: true
    })
  });
  assert(missingApproval.status === 404, "不存在的扩展确认请求应返回 404");
  const extensionPaused = await fetch(url("/api/local-browser/extension/safety"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: verifiedPairingBody.token,
      paused: true
    })
  });
  const extensionPausedBody = await extensionPaused.json();
  assert(extensionPaused.ok, "扩展侧暂停接口失败");
  assert(extensionPausedBody.safety?.paused === true, "扩展侧暂停未生效");
  const extensionResumed = await fetch(url("/api/local-browser/extension/safety"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: verifiedPairingBody.token,
      paused: false
    })
  });
  const extensionResumedBody = await extensionResumed.json();
  assert(extensionResumed.ok, "扩展侧恢复接口失败");
  assert(extensionResumedBody.safety?.paused === false, "扩展侧恢复未生效");

  const savedConfig = await client.fetchJson("/api/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ localBrowserDomainAllowlist: ["example.com", "https://news.example.com/a"] })
  });
  assert(
    savedConfig.body.localBrowserDomainAllowlist?.includes("example.com"),
    "本地浏览器 allowlist 未保存 example.com"
  );
  assert(
    savedConfig.body.localBrowserDomainAllowlist?.includes("news.example.com"),
    "本地浏览器 allowlist 未规范化 URL hostname"
  );
  const statusWithAllowlist = await client.fetchJson("/api/local-browser/status");
  assert(statusWithAllowlist.body.allowlistConfigured === true, "本地浏览器状态未显示 allowlist 已配置");
  const pausedSafety = await client.fetchJson("/api/local-browser/safety", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paused: true })
  });
  assert(pausedSafety.body.paused === true, "本地浏览器暂停开关未生效");
  const pausedAction = await client.fetchJson(
    "/api/local-browser/action",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "navigate",
        url: "https://example.com/"
      })
    },
    true
  );
  assert(pausedAction.response.status === 409, "暂停后本地浏览器动作应被拦截");
  assert(pausedAction.body.error?.includes("暂停"), "暂停拦截缺少友好提示");
  const resumedSafety = await client.fetchJson("/api/local-browser/safety", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paused: false })
  });
  assert(resumedSafety.body.paused === false, "本地浏览器恢复开关未生效");
  await client.fetchJson("/api/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ localBrowserDomainAllowlist: previousAllowlist })
  });

  const snapshot = await client.fetchJson(
    "/api/local-browser/snapshot",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: status.body.endpoint })
    },
    true
  );
  assert([200, 409].includes(snapshot.response.status), "本地浏览器 snapshot 接口状态不合法");
  assert(typeof snapshot.body.ok === "boolean", "本地浏览器 snapshot 接口缺少 ok 字段");

  const screenshot = await client.fetchJson(
    "/api/local-browser/screenshot",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: status.body.endpoint })
    },
    true
  );
  assert([200, 409].includes(screenshot.response.status), "本地浏览器 screenshot 接口状态不合法");
  assert(typeof screenshot.body.ok === "boolean", "本地浏览器 screenshot 接口缺少 ok 字段");
  if (screenshot.body.ok) {
    assert(screenshot.body.dataUrl?.startsWith("data:image/"), "本地浏览器 screenshot 缺少 dataUrl");
  }

  const blockedAction = await client.fetchJson(
    "/api/local-browser/action",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "navigate",
        url: "https://blocked-local-browser-e2e.invalid/"
      })
    },
    true
  );
  assert(blockedAction.response.status === 409, "未加入 allowlist 的导航应被拦截");
  assert(blockedAction.body.ok === false, "被拦截动作不应返回 ok");
  assert(blockedAction.body.allowed === false, "被拦截动作应标记 allowed=false");

  const unknownAction = await client.fetchJson(
    "/api/local-browser/action",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fly" })
    },
    true
  );
  assert(unknownAction.response.status === 400, "未知浏览器动作应返回 400");
  assert(unknownAction.body.action === "unknown", "未知浏览器动作缺少 unknown 标记");
  await client.fetchJson("/api/local-browser/safety", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paused: previousPaused })
  });

  console.log(JSON.stringify({
    ok: true,
    endpoint: status.body.endpoint,
    connected: status.body.connected,
    checked: [
      "auth guard",
      "localhost guard",
      "cdp status",
      "tabs",
      "extension pairing",
      "extension approval guard",
      "extension pause",
      "allowlist config",
      "pause guard",
      "snapshot",
      "screenshot",
      "action guard"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
