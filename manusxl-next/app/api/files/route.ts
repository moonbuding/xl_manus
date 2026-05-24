import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listUploadedFilesForOwner, type UploadedFileRecord } from "@/server/files/readers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicFile(record: UploadedFileRecord) {
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    extension: record.extension,
    size: record.size,
    textPreview: record.textPreview,
    summary: record.summary,
    metadata: record.metadata,
    createdAt: record.createdAt,
    expiresAt: typeof record.metadata.expiresAt === "string" ? record.metadata.expiresAt : undefined
  };
}

export async function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "80");
  const files = await listUploadedFilesForOwner(user.id, Number.isFinite(limit) ? limit : 80);
  return NextResponse.json({ files: files.map(publicFile) });
}
