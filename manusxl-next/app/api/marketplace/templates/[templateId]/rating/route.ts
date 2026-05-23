import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { safeRecordAuditLog } from "@/server/audit/audit-store";
import { rateMarketplaceTemplate } from "@/server/templates/template-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: { templateId: string } | Promise<{ templateId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { templateId } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as { rating?: number };
  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Rating must be between 1 and 5" }, { status: 400 });
  }

  const template = rateMarketplaceTemplate(templateId, rating);

  safeRecordAuditLog({
    userId: user.id,
    action: "template.rate",
    resource: templateId,
    status: template ? "completed" : "failed",
    metadata: {
      templateId,
      rating
    }
  });

  if (!template) {
    return NextResponse.json({ error: "Marketplace template not found" }, { status: 404 });
  }

  return NextResponse.json(template);
}
