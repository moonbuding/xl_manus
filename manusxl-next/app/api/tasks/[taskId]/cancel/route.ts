import { NextResponse } from "next/server";
import { abortAgentTask } from "@/server/agent/runtime";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { cancelMyComputerDesktopTask } from "@/server/my-computer/my-computer";
import { cancelTask } from "@/server/tasks/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: { taskId: string } | Promise<{ taskId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { taskId } = await Promise.resolve(context.params);
  const task = cancelTask(taskId, user.id);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  abortAgentTask(taskId);
  const desktopAssignments = cancelMyComputerDesktopTask(taskId, user.id);

  return NextResponse.json({ ...task, desktopAssignments });
}
