import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { getAuthCookieNames, refreshAccessToken } from "@/server/auth/auth-store";
import { jsonWithSession } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
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
  const refreshed = refreshAccessToken(cookies[refreshCookieName] ?? "");
  if (!refreshed) return NextResponse.json({ error: "Refresh token invalid" }, { status: 401 });
  safeRecordAuditLog({
    userId: refreshed.user.id,
    action: "auth.refresh",
    resource: "session",
    status: "completed",
    ...requestAuditContext(request),
    metadata: { rotated: true }
  });
  return jsonWithSession(
    { user: refreshed.user },
    refreshed.user.id,
    { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken }
  );
}
