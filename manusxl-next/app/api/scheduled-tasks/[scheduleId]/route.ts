import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import {
  deleteScheduledTask,
  getScheduledTask,
  updateScheduledTask
} from "@/server/scheduled/scheduled-task-store";
import type { CreateScheduledTaskRequest } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ scheduleId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { scheduleId } = await context.params;
  const task = getScheduledTask(scheduleId, user.id);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { scheduleId } = await context.params;
  try {
    const body = (await request.json()) as Partial<CreateScheduledTaskRequest>;
    const task = updateScheduledTask(scheduleId, user.id, body);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update scheduled task failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { scheduleId } = await context.params;
  const deleted = deleteScheduledTask(scheduleId, user.id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
