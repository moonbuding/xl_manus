import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { createOrganizationInvitation } from "@/server/orgs/org-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: { orgId: string } | Promise<{ orgId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { orgId } = await Promise.resolve(context.params);
  const body = (await request.json()) as { email?: string; phone?: string; role?: string };
  const result = createOrganizationInvitation({
    orgId,
    invitedBy: user,
    email: body.email,
    phone: body.phone,
    role: body.role
  });

  safeRecordAuditLog({
    userId: user.id,
    action: "org.invite",
    resource: orgId,
    status: result.ok ? "completed" : "blocked",
    ...requestAuditContext(request),
    metadata: {
      role: body.role,
      phoneSuffix: body.phone?.slice(-4),
      emailDomain: body.email?.split("@").at(-1),
      reason: result.ok ? undefined : result.error
    }
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    invitation: result.invitation,
    acceptUrl: `/api/orgs/invitations/accept?token=${encodeURIComponent(result.invitation.token)}`
  });
}
