import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listMcpCatalog } from "@/server/mcp/mcp-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return NextResponse.json({ catalog: listMcpCatalog() });
}
