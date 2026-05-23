import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listNotificationLogs } from "@/server/notifications/notification-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 20);
  return NextResponse.json({
    logs: listNotificationLogs(user.id, Number.isFinite(limit) ? limit : 20)
  });
}
