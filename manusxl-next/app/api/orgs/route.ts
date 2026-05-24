import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { createOrganization, listOrganizationsForUser } from "@/server/orgs/org-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return NextResponse.json({ organizations: listOrganizationsForUser(user) });
}

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json()) as { name?: string; taskQuota?: number };

  try {
    const organization = createOrganization({
      user,
      name: body.name ?? "未命名组织",
      taskQuota: body.taskQuota
    });
    safeRecordAuditLog({
      userId: user.id,
      action: "org.create",
      resource: organization.id,
      status: "completed",
      ...requestAuditContext(request),
      metadata: { orgId: organization.id, taskQuota: organization.taskQuota }
    });
    return NextResponse.json({ organization });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Create organization failed" },
      { status: 400 }
    );
  }
}
