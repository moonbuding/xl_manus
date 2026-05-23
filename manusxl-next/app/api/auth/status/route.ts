import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import { getAuthStatus } from "@/server/auth/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(getAuthStatus(request));
}
