import type { LocalBrowserSnapshot, LocalBrowserStatus, LocalBrowserTab } from "@/types/agent";

const defaultCdpEndpoint = "http://127.0.0.1:9222";
const allowedHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeLocalBrowserEndpoint(endpoint?: string) {
  const raw = endpoint?.trim() || process.env.MANUSXL_LOCAL_BROWSER_CDP_URL?.trim() || defaultCdpEndpoint;
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("本地浏览器 CDP 地址只允许 http/https");
  }
  if (!allowedHosts.has(url.hostname)) {
    throw new Error("本地浏览器 CDP 地址只允许 localhost 或 127.0.0.1");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export async function getLocalBrowserStatus(endpoint?: string): Promise<LocalBrowserStatus> {
  const checkedAt = new Date().toISOString();
  let normalizedEndpoint: string;
  try {
    normalizedEndpoint = normalizeLocalBrowserEndpoint(endpoint);
  } catch (error) {
    return {
      endpoint: endpoint?.trim() || defaultCdpEndpoint,
      connected: false,
      checkedAt,
      error: error instanceof Error ? error.message : "本地浏览器 CDP 地址不合法"
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${normalizedEndpoint}/json/version`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Chrome CDP 返回 HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      Browser?: string;
      "Protocol-Version"?: string;
      webSocketDebuggerUrl?: string;
    };
    return {
      endpoint: normalizedEndpoint,
      connected: true,
      checkedAt,
      browser: data.Browser,
      protocolVersion: data["Protocol-Version"],
      webSocketDebuggerUrl: data.webSocketDebuggerUrl
    };
  } catch (error) {
    return {
      endpoint: normalizedEndpoint,
      connected: false,
      checkedAt,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "连接本地浏览器超时"
          : error instanceof Error
            ? error.message
            : "无法连接本地浏览器 CDP"
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Chrome CDP 返回 HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function listLocalBrowserTabs(endpoint?: string) {
  const status = await getLocalBrowserStatus(endpoint);
  if (!status.connected) {
    return { status, tabs: [] as LocalBrowserTab[] };
  }

  try {
    const tabs = await fetchJson<LocalBrowserTab[]>(`${status.endpoint}/json/list`);
    return {
      status,
      tabs: tabs.filter((tab) => tab.type === "page" && tab.url && !tab.url.startsWith("devtools://"))
    };
  } catch (error) {
    return {
      status: {
        ...status,
        connected: false,
        error: error instanceof Error ? error.message : "无法读取本地浏览器标签页"
      },
      tabs: [] as LocalBrowserTab[]
    };
  }
}

function allowedSnapshotHosts() {
  return new Set(
    (process.env.MANUSXL_LOCAL_BROWSER_DOMAIN_ALLOWLIST ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isSnapshotAllowed(urlValue: string) {
  const allowlist = allowedSnapshotHosts();
  if (allowlist.size === 0) return false;
  try {
    const url = new URL(urlValue);
    const host = url.hostname.toLowerCase();
    return allowlist.has(host) || Array.from(allowlist).some((allowed) => host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function waitForWebSocketOpen(socket: WebSocket, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("连接 Chrome CDP WebSocket 超时")), timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Chrome CDP WebSocket 连接失败"));
    }, { once: true });
  });
}

async function sendCdpCommand<T>(
  webSocketDebuggerUrl: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 3500
) {
  if (typeof WebSocket === "undefined") {
    throw new Error("当前 Node.js 运行时不支持 WebSocket，无法读取本地浏览器页面。");
  }

  const socket = new WebSocket(webSocketDebuggerUrl);
  await waitForWebSocketOpen(socket, timeoutMs);
  try {
    return await new Promise<T>((resolve, reject) => {
      const id = 1;
      const timer = setTimeout(() => reject(new Error("Chrome CDP 命令超时")), timeoutMs);
      socket.addEventListener("message", (event) => {
        const data = JSON.parse(String(event.data)) as {
          id?: number;
          result?: T;
          error?: { message?: string };
        };
        if (data.id !== id) return;
        clearTimeout(timer);
        if (data.error) {
          reject(new Error(data.error.message ?? "Chrome CDP 命令失败"));
          return;
        }
        resolve(data.result as T);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  } finally {
    socket.close();
  }
}

export async function snapshotLocalBrowserTab(input: {
  endpoint?: string;
  tabId?: string;
  maxChars?: number;
} = {}): Promise<LocalBrowserSnapshot> {
  const { status, tabs } = await listLocalBrowserTabs(input.endpoint);
  const tab = input.tabId ? tabs.find((candidate) => candidate.id === input.tabId) : tabs[0];
  if (!status.connected) {
    return {
      endpoint: status.endpoint,
      tabId: input.tabId,
      allowed: false,
      ok: false,
      error: status.error ?? "本地浏览器未连接"
    };
  }
  if (!tab?.webSocketDebuggerUrl) {
    return {
      endpoint: status.endpoint,
      tabId: input.tabId,
      allowed: false,
      ok: false,
      error: "没有可读取的本地浏览器标签页"
    };
  }
  if (!isSnapshotAllowed(tab.url)) {
    return {
      endpoint: status.endpoint,
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      allowed: false,
      ok: false,
      error: "当前域名未加入本地浏览器 allowlist，已阻止读取页面内容。"
    };
  }

  const maxChars = Math.max(200, Math.min(input.maxChars ?? 4000, 12000));
  const expression = `
    (() => {
      const text = (document.body?.innerText || "")
        .replace(/\\s+/g, " ")
        .trim()
        .slice(0, ${maxChars});
      return { title: document.title, url: location.href, text };
    })()
  `;
  const result = await sendCdpCommand<{
    result?: {
      value?: { title?: string; url?: string; text?: string };
    };
  }>(tab.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  const value = result.result?.value;
  return {
    endpoint: status.endpoint,
    tabId: tab.id,
    title: value?.title ?? tab.title,
    url: value?.url ?? tab.url,
    text: value?.text ?? "",
    allowed: true,
    ok: true
  };
}
