import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { deleteTasks } from "@/server/tasks/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json()) as { taskIds?: string[] };
  const taskIds = Array.isArray(body.taskIds) ? body.taskIds.map(String) : [];
  if (taskIds.length === 0) {
    return NextResponse.json({ error: "Task ids are required" }, { status: 400 });
  }
  return NextResponse.json(deleteTasks(taskIds, user.id));
}
