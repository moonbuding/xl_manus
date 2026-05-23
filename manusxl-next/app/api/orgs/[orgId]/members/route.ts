import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import {
  listOrganizationMembers,
  removeOrganizationMember,
  updateOrganizationMemberRole
} from "@/server/orgs/org-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  context: { params: { orgId: string } | Promise<{ orgId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return Promise.resolve(context.params).then(({ orgId }) => {
    const result = listOrganizationMembers(orgId, user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ members: result.members });
  });
}

export async function PATCH(
  request: Request,
  context: { params: { orgId: string } | Promise<{ orgId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { orgId } = await Promise.resolve(context.params);
  const body = (await request.json()) as { userId?: string; role?: string };
  const result = updateOrganizationMemberRole({
    orgId,
    requesterUserId: user.id,
    targetUserId: body.userId ?? "",
    role: body.role ?? "member"
  });

  safeRecordAuditLog({
    userId: user.id,
    action: "org.member.update_role",
    resource: orgId,
    status: result.ok ? "completed" : "blocked",
    ...requestAuditContext(request),
    metadata: {
      targetUserId: body.userId,
      role: body.role,
      reason: result.ok ? undefined : result.error
    }
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const members = listOrganizationMembers(orgId, user.id);
  return NextResponse.json({ membership: result.membership, members: members.ok ? members.members : [] });
}

export async function DELETE(
  request: Request,
  context: { params: { orgId: string } | Promise<{ orgId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { orgId } = await Promise.resolve(context.params);
  const body = (await request.json()) as { userId?: string };
  const result = removeOrganizationMember({
    orgId,
    requesterUserId: user.id,
    targetUserId: body.userId ?? ""
  });

  safeRecordAuditLog({
    userId: user.id,
    action: "org.member.remove",
    resource: orgId,
    status: result.ok ? "completed" : "blocked",
    ...requestAuditContext(request),
    metadata: {
      targetUserId: body.userId,
      removedRole: result.ok ? result.removed.role : undefined,
      reason: result.ok ? undefined : result.error
    }
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const members = listOrganizationMembers(orgId, user.id);
  return NextResponse.json({ removed: result.removed, members: members.ok ? members.members : [] });
}
