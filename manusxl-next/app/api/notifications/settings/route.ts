import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import {
  getNotificationSettings,
  notificationRuntimeStatus,
  updateNotificationSettings,
  type NotificationSettingsPatch
} from "@/server/notifications/notification-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return NextResponse.json({
    settings: getNotificationSettings(user.id),
    runtime: notificationRuntimeStatus()
  });
}

export async function PATCH(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json()) as NotificationSettingsPatch;
  return NextResponse.json({
    settings: updateNotificationSettings(user.id, body),
    runtime: notificationRuntimeStatus()
  });
}
