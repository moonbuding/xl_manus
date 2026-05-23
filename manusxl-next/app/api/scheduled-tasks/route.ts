import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import {
  createScheduledTask,
  listScheduledTaskRunLogs,
  listScheduledTasks,
  scheduledTaskMailbox,
  startScheduledTaskRunner
} from "@/server/scheduled/scheduled-task-store";
import type { CreateScheduledTaskRequest } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  startScheduledTaskRunner();
  return NextResponse.json({
    mailbox: scheduledTaskMailbox(user.id),
    tasks: listScheduledTasks(user.id),
    logs: listScheduledTaskRunLogs(user.id, 12)
  });
}

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();

  try {
    const body = (await request.json()) as CreateScheduledTaskRequest;
    const task = createScheduledTask(user.id, body);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Create scheduled task failed" },
      { status: 400 }
    );
  }
}
