import type {
  LocalBrowserActionResult,
  LocalBrowserActionType,
  LocalBrowserScreenshot,
  LocalBrowserSnapshot,
  LocalBrowserStatus,
  LocalBrowserTab
} from "@/types/agent";
import { getLocalBrowserDomainAllowlist, isLocalBrowserPaused } from "@/server/config/app-config";
import {
  listLocalBrowserOperations,
  recordLocalBrowserOperation,
  updateLocalBrowserOperation
} from "@/server/local-browser/audit";

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
  const allowlistConfigured = allowedSnapshotHosts().size > 0;
  const paused = isLocalBrowserPaused();
  const recentOperations = listLocalBrowserOperations(10);
  let normalizedEndpoint: string;
  try {
    normalizedEndpoint = normalizeLocalBrowserEndpoint(endpoint);
  } catch (error) {
    return {
      endpoint: endpoint?.trim() || defaultCdpEndpoint,
      connected: false,
      checkedAt,
      allowlistConfigured,
      paused,
      recentOperations,
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
      allowlistConfigured,
      paused,
      recentOperations,
      browser: data.Browser,
      protocolVersion: data["Protocol-Version"],
      webSocketDebuggerUrl: data.webSocketDebuggerUrl
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error && error.name === "AbortError"
        ? "连接本地浏览器超时"
        : error instanceof Error && error.message === "fetch failed"
          ? "未检测到本地 Chrome CDP，请确认 Chrome 已用远程调试端口启动。"
          : error instanceof Error
            ? error.message
            : "无法连接本地浏览器 CDP";
    return {
      endpoint: normalizedEndpoint,
      connected: false,
      checkedAt,
      allowlistConfigured,
      paused,
      recentOperations,
      error: errorMessage
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
  return new Set(getLocalBrowserDomainAllowlist());
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
  params: Record<string, unknown> = {},
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(numberValue, max));
}

function normalizeAction(action?: string): LocalBrowserActionType | "unknown" {
  if (action === "navigate" || action === "click" || action === "type" || action === "press") {
    return action;
  }
  return "unknown";
}

function getTargetUrlForAction(urlValue?: string) {
  if (!urlValue?.trim()) return null;
  try {
    const url = new URL(urlValue.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function readViewport(webSocketDebuggerUrl: string) {
  const result = await sendCdpCommand<{
    result?: {
      value?: {
        width?: number;
        height?: number;
      };
    };
  }>(webSocketDebuggerUrl, "Runtime.evaluate", {
    expression: "({ width: window.innerWidth, height: window.innerHeight })",
    returnByValue: true
  });
  return result.result?.value ?? {};
}

async function readSnapshotAfterAction(input: { endpoint?: string; tabId?: string }) {
  const snapshot = await snapshotLocalBrowserTab({
    endpoint: input.endpoint,
    tabId: input.tabId,
    maxChars: 1200
  });
  return snapshot.ok ? snapshot : undefined;
}

export async function snapshotLocalBrowserTab(input: {
  endpoint?: string;
  tabId?: string;
  maxChars?: number;
  ownerId?: string;
  source?: "agent" | "settings" | "api";
} = {}): Promise<LocalBrowserSnapshot> {
  if (isLocalBrowserPaused()) {
    const operation = recordLocalBrowserOperation({
      ownerId: input.ownerId,
      source: input.source,
      action: "snapshot",
      status: "blocked",
      error: "本地浏览器操作已暂停"
    });
    return {
      endpoint: input.endpoint?.trim() || defaultCdpEndpoint,
      tabId: input.tabId,
      allowed: false,
      ok: false,
      error: `本地浏览器操作已暂停（${operation.id}）。`
    };
  }
  const operation = recordLocalBrowserOperation({
    ownerId: input.ownerId,
    source: input.source,
    action: "snapshot"
  });
  const { status, tabs } = await listLocalBrowserTabs(input.endpoint);
  const tab = input.tabId ? tabs.find((candidate) => candidate.id === input.tabId) : tabs[0];
  if (!status.connected) {
    updateLocalBrowserOperation(operation.id, {
      status: "failed",
      error: status.error ?? "本地浏览器未连接"
    });
    return {
      endpoint: status.endpoint,
      tabId: input.tabId,
      allowed: false,
      ok: false,
      error: status.error ?? "本地浏览器未连接"
    };
  }
  if (!tab?.webSocketDebuggerUrl) {
    updateLocalBrowserOperation(operation.id, {
      status: "failed",
      error: "没有可读取的本地浏览器标签页"
    });
    return {
      endpoint: status.endpoint,
      tabId: input.tabId,
      allowed: false,
      ok: false,
      error: "没有可读取的本地浏览器标签页"
    };
  }
  if (!isSnapshotAllowed(tab.url)) {
    updateLocalBrowserOperation(operation.id, {
      status: "blocked",
      title: tab.title,
      url: tab.url,
      tabId: tab.id,
      error: "当前域名未加入本地浏览器 allowlist"
    });
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
  updateLocalBrowserOperation(operation.id, {
    status: "completed",
    title: value?.title ?? tab.title,
    url: value?.url ?? tab.url,
    tabId: tab.id
  });
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

export async function screenshotLocalBrowserTab(input: {
  endpoint?: string;
  tabId?: string;
  format?: "jpeg" | "png";
  quality?: number;
  ownerId?: string;
  source?: "agent" | "settings" | "api";
} = {}): Promise<LocalBrowserScreenshot> {
  if (isLocalBrowserPaused()) {
    const operation = recordLocalBrowserOperation({
      ownerId: input.ownerId,
      source: input.source,
      action: "screenshot",
      status: "blocked",
      error: "本地浏览器操作已暂停"
    });
    return {
      endpoint: input.endpoint?.trim() || defaultCdpEndpoint,
      tabId: input.tabId,
      allowed: false,
      ok: false,
      error: `本地浏览器操作已暂停（${operation.id}）。`
    };
  }
  const operation = recordLocalBrowserOperation({
    ownerId: input.ownerId,
    source: input.source,
    action: "screenshot"
  });
  const { status, tabs } = await listLocalBrowserTabs(input.endpoint);
  const tab = input.tabId ? tabs.find((candidate) => candidate.id === input.tabId) : tabs[0];
  if (!status.connected) {
    updateLocalBrowserOperation(operation.id, {
      status: "failed",
      error: status.error ?? "本地浏览器未连接"
    });
    return {
      endpoint: status.endpoint,
      tabId: input.tabId,
      allowed: false,
      ok: false,
      error: status.error ?? "本地浏览器未连接"
    };
  }
  if (!tab?.webSocketDebuggerUrl) {
    updateLocalBrowserOperation(operation.id, {
      status: "failed",
      error: "没有可截图的本地浏览器标签页"
    });
    return {
      endpoint: status.endpoint,
      tabId: input.tabId,
      allowed: false,
      ok: false,
      error: "没有可截图的本地浏览器标签页"
    };
  }
  if (!isSnapshotAllowed(tab.url)) {
    updateLocalBrowserOperation(operation.id, {
      status: "blocked",
      title: tab.title,
      url: tab.url,
      tabId: tab.id,
      error: "当前域名未加入本地浏览器 allowlist"
    });
    return {
      endpoint: status.endpoint,
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      allowed: false,
      ok: false,
      error: "当前域名未加入本地浏览器 allowlist，已阻止页面截图。"
    };
  }

  await sendCdpCommand(tab.webSocketDebuggerUrl, "Page.bringToFront");
  const viewport = await readViewport(tab.webSocketDebuggerUrl);
  const format = input.format === "png" ? "png" : "jpeg";
  const quality = clampNumber(input.quality, 70, 30, 95);
  const capture = await sendCdpCommand<{ data?: string }>(tab.webSocketDebuggerUrl, "Page.captureScreenshot", {
    format,
    quality: format === "jpeg" ? quality : undefined,
    captureBeyondViewport: false,
    fromSurface: true
  });
  if (!capture.data) {
    updateLocalBrowserOperation(operation.id, {
      status: "failed",
      title: tab.title,
      url: tab.url,
      tabId: tab.id,
      error: "Chrome CDP 未返回截图数据"
    });
    return {
      endpoint: status.endpoint,
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      allowed: true,
      ok: false,
      error: "Chrome CDP 未返回截图数据"
    };
  }

  const mimeType = format === "png" ? "image/png" : "image/jpeg";
  updateLocalBrowserOperation(operation.id, {
    status: "completed",
    title: tab.title,
    url: tab.url,
    tabId: tab.id
  });
  return {
    endpoint: status.endpoint,
    tabId: tab.id,
    title: tab.title,
    url: tab.url,
    mimeType,
    dataUrl: `data:${mimeType};base64,${capture.data}`,
    width: viewport.width,
    height: viewport.height,
    allowed: true,
    ok: true
  };
}

export async function runLocalBrowserAction(input: {
  endpoint?: string;
  tabId?: string;
  action?: string;
  url?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  waitMs?: number;
  ownerId?: string;
  source?: "agent" | "settings" | "api";
}): Promise<LocalBrowserActionResult> {
  const action = normalizeAction(input.action);
  if (isLocalBrowserPaused()) {
    const operation = recordLocalBrowserOperation({
      ownerId: input.ownerId,
      source: input.source,
      action,
      status: "blocked",
      error: "本地浏览器操作已暂停"
    });
    return {
      endpoint: input.endpoint?.trim() || defaultCdpEndpoint,
      tabId: input.tabId,
      action,
      allowed: false,
      ok: false,
      error: `本地浏览器操作已暂停（${operation.id}）。`
    };
  }
  const operation = recordLocalBrowserOperation({
    ownerId: input.ownerId,
    source: input.source,
    action
  });
  if (action === "unknown") {
    updateLocalBrowserOperation(operation.id, {
      status: "blocked",
      error: "不支持的本地浏览器动作"
    });
    return {
      endpoint: input.endpoint?.trim() || defaultCdpEndpoint,
      tabId: input.tabId,
      action,
      allowed: false,
      ok: false,
      error: "不支持的本地浏览器动作。"
    };
  }

  const targetUrl = action === "navigate" ? getTargetUrlForAction(input.url) : null;
  if (action === "navigate") {
    if (!targetUrl) {
      updateLocalBrowserOperation(operation.id, {
        status: "blocked",
        error: "导航动作需要有效的 http/https URL"
      });
      return {
        endpoint: input.endpoint?.trim() || defaultCdpEndpoint,
        tabId: input.tabId,
        action,
        allowed: false,
        ok: false,
        error: "导航动作需要有效的 http/https URL。"
      };
    }
    if (!isSnapshotAllowed(targetUrl)) {
      updateLocalBrowserOperation(operation.id, {
        status: "blocked",
        url: targetUrl,
        error: "目标域名未加入本地浏览器 allowlist"
      });
      return {
        endpoint: input.endpoint?.trim() || defaultCdpEndpoint,
        tabId: input.tabId,
        url: targetUrl,
        action,
        allowed: false,
        ok: false,
        error: "目标域名未加入本地浏览器 allowlist，已阻止导航。"
      };
    }
  }

  const { status, tabs } = await listLocalBrowserTabs(input.endpoint);
  const tab = input.tabId ? tabs.find((candidate) => candidate.id === input.tabId) : tabs[0];
  if (!status.connected) {
    updateLocalBrowserOperation(operation.id, {
      status: "failed",
      error: status.error ?? "本地浏览器未连接"
    });
    return {
      endpoint: status.endpoint,
      tabId: input.tabId,
      action,
      allowed: false,
      ok: false,
      error: status.error ?? "本地浏览器未连接"
    };
  }
  if (!tab?.webSocketDebuggerUrl) {
    updateLocalBrowserOperation(operation.id, {
      status: "failed",
      error: "没有可操作的本地浏览器标签页"
    });
    return {
      endpoint: status.endpoint,
      tabId: input.tabId,
      action,
      allowed: false,
      ok: false,
      error: "没有可操作的本地浏览器标签页"
    };
  }
  if (action !== "navigate" && !isSnapshotAllowed(tab.url)) {
    updateLocalBrowserOperation(operation.id, {
      status: "blocked",
      title: tab.title,
      url: tab.url,
      tabId: tab.id,
      error: "当前域名未加入本地浏览器 allowlist"
    });
    return {
      endpoint: status.endpoint,
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      action,
      allowed: false,
      ok: false,
      error: "当前域名未加入本地浏览器 allowlist，已阻止浏览器动作。"
    };
  }

  await sendCdpCommand(tab.webSocketDebuggerUrl, "Page.bringToFront");
  const waitMs = clampNumber(input.waitMs, 700, 0, 3000);
  if (action === "navigate") {
    await sendCdpCommand(tab.webSocketDebuggerUrl, "Page.navigate", { url: targetUrl });
  }
  if (action === "click") {
    const x = clampNumber(input.x, Number.NaN, 0, 20000);
    const y = clampNumber(input.y, Number.NaN, 0, 20000);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      updateLocalBrowserOperation(operation.id, {
        status: "failed",
        title: tab.title,
        url: tab.url,
        tabId: tab.id,
        error: "点击动作需要有效的 x/y 坐标"
      });
      return {
        endpoint: status.endpoint,
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        action,
        allowed: true,
        ok: false,
        error: "点击动作需要有效的 x/y 坐标。"
      };
    }
    await sendCdpCommand(tab.webSocketDebuggerUrl, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y
    });
    await sendCdpCommand(tab.webSocketDebuggerUrl, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1
    });
    await sendCdpCommand(tab.webSocketDebuggerUrl, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1
    });
  }
  if (action === "type") {
    const text = String(input.text ?? "").slice(0, 1000);
    if (!text) {
      updateLocalBrowserOperation(operation.id, {
        status: "failed",
        title: tab.title,
        url: tab.url,
        tabId: tab.id,
        error: "输入动作需要文本"
      });
      return {
        endpoint: status.endpoint,
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        action,
        allowed: true,
        ok: false,
        error: "输入动作需要文本。"
      };
    }
    await sendCdpCommand(tab.webSocketDebuggerUrl, "Input.insertText", { text });
  }
  if (action === "press") {
    const key = String(input.key ?? "").trim().slice(0, 40);
    if (!key) {
      updateLocalBrowserOperation(operation.id, {
        status: "failed",
        title: tab.title,
        url: tab.url,
        tabId: tab.id,
        error: "按键动作需要 key"
      });
      return {
        endpoint: status.endpoint,
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        action,
        allowed: true,
        ok: false,
        error: "按键动作需要 key。"
      };
    }
    await sendCdpCommand(tab.webSocketDebuggerUrl, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key
    });
    await sendCdpCommand(tab.webSocketDebuggerUrl, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key
    });
  }

  if (waitMs > 0) await wait(waitMs);
  const snapshot = await readSnapshotAfterAction({ endpoint: status.endpoint, tabId: tab.id });
  updateLocalBrowserOperation(operation.id, {
    status: "completed",
    title: snapshot?.title ?? tab.title,
    url: snapshot?.url ?? (targetUrl || tab.url),
    tabId: tab.id
  });
  return {
    endpoint: status.endpoint,
    tabId: tab.id,
    title: snapshot?.title ?? tab.title,
    url: snapshot?.url ?? (targetUrl || tab.url),
    action,
    allowed: true,
    ok: true,
    message: "本地浏览器动作已执行。",
    snapshot
  };
}
