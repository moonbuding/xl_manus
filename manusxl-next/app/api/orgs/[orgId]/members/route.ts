import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listOrganizationMembers } from "@/server/orgs/org-store";

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
