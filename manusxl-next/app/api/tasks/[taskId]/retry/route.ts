import { NextResponse } from "next/server";
import { enqueueAgentTask } from "@/server/agent/scheduler";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { createTask, getTask } from "@/server/tasks/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: { taskId: string } | Promise<{ taskId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();

  const { taskId } = await Promise.resolve(context.params);
  const sourceTask = getTask(taskId, user.id);
  if (!sourceTask) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const retryTask = createTask(
    sourceTask.prompt,
    sourceTask.model,
    user.id,
    sourceTask.uploadedFileIds ?? []
  );
  const queue = enqueueAgentTask(retryTask.id);

  return NextResponse.json({
    taskId: retryTask.id,
    status: retryTask.status,
    queue
  });
}
