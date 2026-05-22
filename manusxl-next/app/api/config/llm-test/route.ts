import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { testDeepSeekConnection } from "@/server/llm/deepseek";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const result = await testDeepSeekConnection(controller.signal);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } finally {
    clearTimeout(timeout);
  }
}
