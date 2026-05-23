import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { getDatabaseStatus } from "@/server/db/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();

  const url = new URL(request.url);
  return NextResponse.json(
    getDatabaseStatus({
      checkPostgres: url.searchParams.get("check") === "1"
    })
  );
}
