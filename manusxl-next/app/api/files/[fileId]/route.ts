import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { deleteUploadedFileForOwner } from "@/server/files/readers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: { fileId: string } | Promise<{ fileId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { fileId } = await Promise.resolve(context.params);
  const deleted = await deleteUploadedFileForOwner(fileId, user.id);
  if (!deleted) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true, fileId });
}
