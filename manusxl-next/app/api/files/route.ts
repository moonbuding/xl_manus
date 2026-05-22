import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listUploadedFileRecordsForOwner } from "@/server/files/readers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const files = await listUploadedFileRecordsForOwner(user.id, Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      extension: file.extension,
      size: file.size,
      textPreview: file.textPreview,
      summary: file.summary,
      metadata: file.metadata,
      createdAt: file.createdAt,
      expiresAt: file.expiresAt
    }))
  });
}
