import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { getOcrStatus } from "@/server/ocr/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return NextResponse.json(await getOcrStatus());
}
