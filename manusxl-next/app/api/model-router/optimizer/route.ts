import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { getRouterOptimizerSnapshot } from "@/server/llm/router-optimizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const prompt = url.searchParams.get("prompt") ?? "";
  return NextResponse.json(getRouterOptimizerSnapshot(user.id, prompt));
}
