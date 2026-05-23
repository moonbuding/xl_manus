import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { safeRecordAuditLog } from "@/server/audit/audit-store";
import { forkMarketplaceTemplate } from "@/server/templates/template-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: { templateId: string } | Promise<{ templateId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { templateId } = await Promise.resolve(context.params);
  const template = forkMarketplaceTemplate(templateId, user.id);

  safeRecordAuditLog({
    userId: user.id,
    action: "template.fork",
    resource: templateId,
    status: template ? "completed" : "failed",
    metadata: {
      sourceTemplateId: templateId,
      forkedTemplateId: template?.id
    }
  });

  if (!template) {
    return NextResponse.json({ error: "Marketplace template not found" }, { status: 404 });
  }

  return NextResponse.json(template);
}
