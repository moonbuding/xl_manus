import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { acceptOrganizationInvitation } from "@/server/orgs/org-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const token = body.token ?? url.searchParams.get("token") ?? "";
  const result = acceptOrganizationInvitation({ token, user });

  safeRecordAuditLog({
    userId: user.id,
    action: "org.invitation.accept",
    resource: "organization_invitation",
    status: result.ok ? "completed" : "blocked",
    ...requestAuditContext(request),
    metadata: {
      orgId: result.ok ? result.invitation.orgId : undefined,
      reason: result.ok ? undefined : result.error
    }
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
