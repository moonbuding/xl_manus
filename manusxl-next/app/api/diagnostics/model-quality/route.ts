import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { runModelQualityBenchmark } from "@/server/llm/model-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return NextResponse.json(runModelQualityBenchmark());
}
