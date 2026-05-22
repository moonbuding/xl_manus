import type { LocalBrowserStatus } from "@/types/agent";

const defaultCdpEndpoint = "http://127.0.0.1:9222";
const allowedHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function normalizeEndpoint(endpoint?: string) {
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
    normalizedEndpoint = normalizeEndpoint(endpoint);
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
