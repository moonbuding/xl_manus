import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import { scanMyComputerFiles } from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as {
    root?: string;
    maxFiles?: number;
    maxDepth?: number;
  };

  try {
    return NextResponse.json(
      await scanMyComputerFiles({
        ownerId: user.id,
        root: body.root,
        maxFiles: body.maxFiles,
        maxDepth: body.maxDepth,
        request
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
