import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import { planMyComputerFileOperation } from "@/server/my-computer/my-computer";
import type { MyComputerFilePlanMode } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validModes = new Set<MyComputerFilePlanMode>(["classify", "dedupe", "rename"]);

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as {
    root?: string;
    mode?: MyComputerFilePlanMode;
    maxFiles?: number;
  };
  const mode = body.mode ?? "classify";
  if (!validModes.has(mode)) {
    return NextResponse.json({ error: "不支持的文件操作模式。" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await planMyComputerFileOperation({
        ownerId: user.id,
        root: body.root,
        mode,
        maxFiles: body.maxFiles
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
