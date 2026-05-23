import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const marker = "MANUSXL_LOCAL_BROWSER_AUTHENTICATED_REHEARSAL";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    assert(cookieJar.has("manusxl_session"), "登录后没有收到 manusxl_session Cookie");
  }

  return { cookieJar, fetchJson, login };
}

function findChromeBinary() {
  const candidates = [
    process.env.MANUSXL_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

async function waitForCdp(endpoint, timeoutMs = 10000) {
  const startedAt = Date.now();
  let lastError = "Chrome CDP 尚未就绪";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${endpoint}/json/version`, { cache: "no-store" });
      if (response.ok) return;
      lastError = `Chrome CDP 返回 HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await wait(250);
  }
  throw new Error(`等待 Chrome CDP 超时：${lastError}`);
}

async function getFirstPage(endpoint) {
  const response = await fetch(`${endpoint}/json/list`, { cache: "no-store" });
  assert(response.ok, `读取 Chrome tabs 失败：HTTP ${response.status}`);
  const tabs = await response.json();
  const tab = tabs.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  assert(tab, "Chrome CDP 没有可操作页面标签");
  return tab;
}

async function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("连接 Chrome CDP WebSocket 超时")), 5000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Chrome CDP WebSocket 连接失败"));
    }, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(String(event.data));
    if (!data.id) return;
    const handler = pending.get(data.id);
    if (!handler) return;
    clearTimeout(handler.timer);
    pending.delete(data.id);
    if (data.error) {
      handler.reject(new Error(data.error.message ?? "Chrome CDP 命令失败"));
      return;
    }
    handler.resolve(data.result);
  });

  function send(method, params = {}, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome CDP 命令超时：${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  function close() {
    for (const [id, handler] of pending) {
      clearTimeout(handler.timer);
      handler.reject(new Error("Chrome CDP 连接已关闭"));
      pending.delete(id);
    }
    socket.close();
  }

  return { close, send };
}

async function navigateAuthenticatedChrome(endpoint, client) {
  const page = await getFirstPage(endpoint);
  const cdp = await createCdpClient(page.webSocketDebuggerUrl);
  const targetUrl = url("/local-browser/rehearsal");

  try {
    await cdp.send("Network.enable");
    for (const [name, value] of client.cookieJar.entries()) {
      if (!name.startsWith("manusxl_")) continue;
      const result = await cdp.send("Network.setCookie", {
        name,
        value,
        url: baseUrl,
        path: "/",
        httpOnly: true,
        sameSite: "Lax"
      });
      assert(result?.success !== false, `写入 Chrome Cookie 失败：${name}`);
    }
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: targetUrl });
    const startedAt = Date.now();
    let text = "";
    while (Date.now() - startedAt < 8000) {
      const result = await cdp.send("Runtime.evaluate", {
        expression: "document.body?.innerText || ''",
        returnByValue: true
      });
      text = String(result?.result?.value ?? "");
      if (text.includes(marker)) return;
      await wait(250);
    }
    assert(false, `Chrome 页面没有读到登录态演练正文，当前文本预览：${text.slice(0, 120)}`);
  } finally {
    cdp.close();
  }
}

async function main() {
  const chromeBinary = findChromeBinary();
  assert(chromeBinary, "没有找到 Chrome/Chromium，请设置 MANUSXL_CHROME_BIN 指向浏览器可执行文件");

  const base = new URL(baseUrl);
  const allowHost = base.hostname;
  const port = 9223 + Math.floor(Math.random() * 700);
  const endpoint = `http://127.0.0.1:${port}`;
  const userDataDir = await mkdtemp(join(tmpdir(), "manusxl-local-browser-"));
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  let previousAllowlist = null;
  let previousPaused = null;
  let chrome;

  try {
    console.log(`ManusXL local browser login-state rehearsal: ${baseUrl}`);
    await client.login();

    const previousConfig = await client.fetchJson("/api/config");
    previousAllowlist = previousConfig.body.localBrowserDomainAllowlist ?? [];
    const previousSafety = await client.fetchJson("/api/local-browser/safety");
    previousPaused = Boolean(previousSafety.body.paused);

    chrome = spawn(chromeBinary, [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-gpu",
      "about:blank"
    ], {
      stdio: "ignore"
    });

    chrome.on("exit", (code, signal) => {
      if (code && code !== 0) {
        console.error(`Chrome 进程提前退出：code=${code}, signal=${signal ?? "none"}`);
      }
    });

    await waitForCdp(endpoint);
    await navigateAuthenticatedChrome(endpoint, client);

    await client.fetchJson("/api/local-browser/safety", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: false })
    });
    await client.fetchJson("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ localBrowserDomainAllowlist: [...new Set([...previousAllowlist, allowHost])] })
    });

    const snapshot = await client.fetchJson("/api/local-browser/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, maxChars: 5000 })
    });
    assert(snapshot.body.ok === true, `本地浏览器 snapshot 未成功：${snapshot.body.error ?? "unknown"}`);
    assert(snapshot.body.allowed === true, "本地浏览器 snapshot 没有通过 allowlist");
    assert(snapshot.body.text?.includes(marker), "后端 snapshot 没有读到登录态演练正文");

    console.log(JSON.stringify({
      ok: true,
      endpoint,
      rehearsalUrl: url("/local-browser/rehearsal"),
      allowHost,
      textIncludesAuthenticatedMarker: true,
      checked: [
        "phone auth cookies",
        "headless chrome cdp startup",
        "cdp cookie injection",
        "authenticated rehearsal page",
        "api snapshot with login-state page text"
      ]
    }, null, 2));
  } finally {
    if (previousAllowlist) {
      await client.fetchJson("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localBrowserDomainAllowlist: previousAllowlist })
      }).catch((error) => {
        console.error(`恢复本地浏览器 allowlist 失败：${error instanceof Error ? error.message : error}`);
      });
    }
    if (previousPaused !== null) {
      await client.fetchJson("/api/local-browser/safety", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: previousPaused })
      }).catch((error) => {
        console.error(`恢复本地浏览器暂停状态失败：${error instanceof Error ? error.message : error}`);
      });
    }
    if (chrome && !chrome.killed) chrome.kill("SIGTERM");
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
