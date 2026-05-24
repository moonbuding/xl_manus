import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { deleteTaskFolder, updateTaskFolder } from "@/server/tasks/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: { folderId: string } | Promise<{ folderId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { folderId } = await Promise.resolve(context.params);
  const body = (await request.json()) as { name?: string };
  const result = updateTaskFolder(folderId, user.id, body.name ?? "");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.folder);
}

export async function DELETE(
  request: Request,
  context: { params: { folderId: string } | Promise<{ folderId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { folderId } = await Promise.resolve(context.params);
  const result = deleteTaskFolder(folderId, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ deleted: true, folderId });
}
