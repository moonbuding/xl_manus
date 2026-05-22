import { getAuthCookieNames, revokeRefreshToken } from "@/server/auth/auth-store";
import { jsonClearingSession } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function refreshTokenFromRequest(request: Request) {
  const { refreshCookieName } = getAuthCookieNames();
  const cookies = Object.fromEntries(
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index >= 0 ? [part.slice(0, index), decodeURIComponent(part.slice(index + 1))] : [part, ""];
      })
  );
  return cookies[refreshCookieName];
}

export async function POST(request: Request) {
  revokeRefreshToken(refreshTokenFromRequest(request));
  return jsonClearingSession({ ok: true });
}
