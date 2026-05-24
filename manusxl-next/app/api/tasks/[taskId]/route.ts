import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { canUserReadOrgTask } from "@/server/orgs/org-store";
import { deleteTask, getTask, updateTaskMetadata } from "@/server/tasks/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: { taskId: string } | Promise<{ taskId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { taskId } = await Promise.resolve(context.params);
  const ownedTask = getTask(taskId, user.id);
  const sharedTask = ownedTask ? undefined : getTask(taskId);
  const task = ownedTask ?? (sharedTask && canUserReadOrgTask(user.id, taskId) ? sharedTask : undefined);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(task);
}

export async function PATCH(
  request: Request,
  context: { params: { taskId: string } | Promise<{ taskId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { taskId } = await Promise.resolve(context.params);
  const body = (await request.json()) as { title?: string | null; folderId?: string | null };
  const patch: { title?: string | null; folderId?: string | null } = {};
  if ("title" in body) patch.title = body.title ?? null;
  if ("folderId" in body) patch.folderId = body.folderId ?? null;
  const result = updateTaskMetadata(taskId, user.id, patch);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.task);
}

export async function DELETE(
  request: Request,
  context: { params: { taskId: string } | Promise<{ taskId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { taskId } = await Promise.resolve(context.params);
  const result = deleteTask(taskId, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ deleted: true, taskId });
}
