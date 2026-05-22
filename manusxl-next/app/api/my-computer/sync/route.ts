import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { createMyComputerSyncUploadOperation } from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = currentUserFromRequest(request);
    if (!user) return unauthorized();
    const body = (await request.json()) as {
      sourcePath?: string;
      dryRun?: boolean;
    };
    const sourcePath = body.sourcePath?.trim();
    if (!sourcePath) {
      return NextResponse.json({ error: "sourcePath is required" }, { status: 400 });
    }
    const operation = await createMyComputerSyncUploadOperation({
      ownerId: user.id,
      sourcePath,
      dryRun: body.dryRun ?? true
    });
    return NextResponse.json({ operation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建同步授权失败" },
      { status: 400 }
    );
  }
}
