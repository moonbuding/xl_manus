import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { getAuthCookieNames, revokeRefreshToken } from "@/server/auth/auth-store";
import { currentUserFromRequest, jsonClearingSession } from "@/server/auth/http";

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
  const user = currentUserFromRequest(request);
  revokeRefreshToken(refreshTokenFromRequest(request));
  if (user) {
    safeRecordAuditLog({
      userId: user.id,
      action: "auth.logout",
      resource: "session",
      status: "completed",
      ...requestAuditContext(request)
    });
  }
  return jsonClearingSession({ ok: true });
}
