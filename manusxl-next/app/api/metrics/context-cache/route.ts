import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { getContextMetricsSummary } from "@/server/metrics/context-metrics";
import { getTask } from "@/server/tasks/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId") ?? undefined;
  if (taskId && !getTask(taskId, user.id)) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json(getContextMetricsSummary(taskId, user.id));
}
