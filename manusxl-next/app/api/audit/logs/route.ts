import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { auditLogsToCsv, listAuditLogs } from "@/server/audit/audit-store";
import type { AuditLogStatus } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auditStatus(value: string | null): AuditLogStatus | undefined {
  return value === "started" || value === "completed" || value === "failed" || value === "blocked"
    ? value
    : undefined;
}

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit"));
  const offset = Number(url.searchParams.get("offset"));
  const result = listAuditLogs({
    userId: user.id,
    taskId: url.searchParams.get("taskId") ?? undefined,
    action: url.searchParams.get("action") ?? undefined,
    status: auditStatus(url.searchParams.get("status")),
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined
  });

  if (url.searchParams.get("format") === "csv") {
    return new NextResponse(auditLogsToCsv(result.logs), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="manusxl-audit-${new Date().toISOString().slice(0, 10)}.csv"`
      }
    });
  }

  return NextResponse.json(result);
}
