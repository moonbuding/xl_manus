import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { sendTestNotification } from "@/server/notifications/notification-store";
import type { TaskStatus } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseStatus(value: unknown): Extract<TaskStatus, "completed" | "failed" | "cancelled" | "timeout"> {
  if (value === "failed" || value === "cancelled" || value === "timeout") return value;
  return "completed";
}

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { status?: string };
  const logs = await sendTestNotification(user.id, parseStatus(body.status));
  return NextResponse.json({ logs });
}
