import { NextResponse } from "next/server";
import { verifyAuditChain } from "@/server/audit/audit-store";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return NextResponse.json(verifyAuditChain(user.id));
}
