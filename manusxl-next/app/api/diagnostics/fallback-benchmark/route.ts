import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { runFallbackBenchmark } from "@/server/agent/fallback-benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { iterations?: number };
  const result = await runFallbackBenchmark(body.iterations);
  return NextResponse.json(result);
}
