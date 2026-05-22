import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
  console.log(`ManusXL My Computer E2E base URL: ${baseUrl}`);
  const anonymous = await fetch(url("/api/my-computer/status"));
  assert(anonymous.status === 401, "My Computer 状态接口未登录应返回 401");

  const root = resolve(".manusxl-data", `e2e-my-computer-${Date.now()}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "report one.txt"), "hello report");
  writeFileSync(join(root, "photo sample.jpg"), "fake image bytes");
  writeFileSync(join(root, "duplicate-a.txt"), "same content");
  writeFileSync(join(root, "duplicate-b.txt"), "same content");

  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const settings = await client.fetchJson("/api/my-computer/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowedRoots: [root], paused: false })
  });
  assert(settings.body.connected === true, "My Computer 桥接未连接");
  assert(settings.body.allowedRoots.includes(root), "允许目录未保存");

  const status = await client.fetchJson("/api/my-computer/status");
  assert(status.body.bridge === "next-local", "My Computer MVP 桥接类型不正确");
  assert(status.body.capabilities.some((capability) => capability.id === "file_classify"), "缺少文件分类能力");
  assert(status.body.capabilities.some((capability) => capability.id === "app_launch"), "缺少应用启动能力");

  const scan = await client.fetchJson("/api/my-computer/files/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root, maxFiles: 20, maxDepth: 1 })
  });
  assert(scan.body.total >= 4, "本机目录扫描没有返回测试文件");

  const classify = await client.fetchJson("/api/my-computer/files/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root, mode: "classify", maxFiles: 20 })
  });
  assert(classify.body.operation.status === "pending_approval", "文件分类 dry-run 应等待授权");
  assert(classify.body.summary.actionCount >= 4, "文件分类 dry-run 动作数量不正确");

  const approvedClassify = await client.fetchJson("/api/my-computer/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operationId: classify.body.operation.id, decision: "allow_once" })
  });
  assert(approvedClassify.body.operation.status === "completed", "文件分类授权后未完成");
  assert(
    existsSync(join(root, "ManusXL Sorted", "documents", "report one.txt")),
    "文件分类没有移动文档文件"
  );
  assert(
    existsSync(join(root, "ManusXL Sorted", "images", "photo sample.jpg")),
    "文件分类没有移动图片文件"
  );

  writeFileSync(join(root, "duplicate-c.txt"), "same content again");
  writeFileSync(join(root, "duplicate-d.txt"), "same content again");
  const dedupe = await client.fetchJson("/api/my-computer/files/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root, mode: "dedupe", maxFiles: 40 })
  });
  assert(dedupe.body.operation.status === "pending_approval", "查重 dry-run 应等待授权");
  assert(dedupe.body.summary.actionCount >= 1, "内容查重没有识别重复文件");
  const deniedDedupe = await client.fetchJson("/api/my-computer/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operationId: dedupe.body.operation.id, decision: "deny" })
  });
  assert(deniedDedupe.body.operation.status === "blocked", "拒绝查重操作后状态应为 blocked");

  const appLaunch = await client.fetchJson("/api/my-computer/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "app_launch", target: "Calculator", dryRun: true })
  });
  assert(appLaunch.body.operation.status === "pending_approval", "启动应用 dry-run 应等待授权");
  const deniedApp = await client.fetchJson("/api/my-computer/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operationId: appLaunch.body.operation.id, decision: "deny" })
  });
  assert(deniedApp.body.operation.status === "blocked", "拒绝启动应用后状态应为 blocked");

  const clipboard = await client.fetchJson("/api/my-computer/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "clipboard_write", text: "My Computer E2E", dryRun: true })
  });
  assert(clipboard.body.operation.status === "pending_approval", "剪贴板 dry-run 应等待授权");

  const mouse = await client.fetchJson("/api/my-computer/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "mouse_click", x: 10, y: 10, dryRun: true })
  });
  assert(mouse.body.operation.status === "pending_approval", "鼠标动作 dry-run 应等待授权");

  const blockedOutsideRoot = await client.fetchJson(
    "/api/my-computer/files/scan",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: resolve(".."), maxFiles: 5 })
    },
    true
  );
  assert(blockedOutsideRoot.response.status === 400, "允许目录外路径应被拦截");

  const audit = await client.fetchJson("/api/audit/logs?limit=30");
  assert(
    audit.body.logs.some((log) => String(log.action).startsWith("my_computer.")),
    "My Computer 操作缺少审计日志"
  );

  console.log(JSON.stringify({
    ok: true,
    root,
    checks: [
      "auth guard",
      "bridge status",
      "allowed roots",
      "file scan",
      "classify dry-run and approval",
      "content dedupe dry-run",
      "app launch authorization",
      "clipboard authorization",
      "mouse authorization",
      "path guard",
      "audit log"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
