import { NextResponse } from "next/server";
import { decideMyComputerDesktopFileUploadRequest } from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

export async function POST(
  request: Request,
  context: { params: { requestId: string } | Promise<{ requestId: string }> }
) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    decision?: "approve" | "deny";
    uploadedFileId?: string;
    error?: string;
  };
  const { requestId } = await Promise.resolve(context.params);
  const result = decideMyComputerDesktopFileUploadRequest({
    token: bearerToken(request) ?? body.token,
    requestId,
    decision: body.decision,
    uploadedFileId: body.uploadedFileId,
    error: body.error
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
