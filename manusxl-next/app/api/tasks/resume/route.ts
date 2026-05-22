import { NextResponse } from "next/server";
import { enqueueAgentTask } from "@/server/agent/scheduler";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listRecoverableTasks } from "@/server/tasks/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();

  const recoverableTasks = listRecoverableTasks(user.id);
  const results = recoverableTasks.map((task) => enqueueAgentTask(task.id, { resumed: true }));

  return NextResponse.json({
    resumedTaskIds: results
      .filter((result) => result.status === "queued" || result.status === "running")
      .map((result) => result.taskId),
    skippedTaskIds: results
      .filter((result) => result.status === "skipped" || result.status === "missing")
      .map((result) => result.taskId),
    results
  });
}
