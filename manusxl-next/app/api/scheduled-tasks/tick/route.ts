import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { runDueScheduledTasks, startScheduledTaskRunner } from "@/server/scheduled/scheduled-task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  startScheduledTaskRunner();
  const logs = runDueScheduledTasks(user.id);
  return NextResponse.json({ logs });
}
