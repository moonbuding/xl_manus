import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { safeRecordAuditLog } from "@/server/audit/audit-store";
import { publishTemplate } from "@/server/templates/template-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: { templateId: string } | Promise<{ templateId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { templateId } = await Promise.resolve(context.params);
  const result = publishTemplate(templateId, user.id, user.displayName);

  safeRecordAuditLog({
    userId: user.id,
    action: "template.publish",
    resource: templateId,
    status: result.ok ? "completed" : result.status === 404 ? "failed" : "blocked",
    metadata: {
      templateId,
      reviewStatus: result.template?.reviewStatus,
      reason: result.error
    }
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, template: result.template },
      { status: result.status }
    );
  }

  return NextResponse.json(result.template);
}
