import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { deleteTemplate } from "@/server/templates/template-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: { templateId: string } | Promise<{ templateId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { templateId } = await Promise.resolve(context.params);
  const deleted = deleteTemplate(templateId, user.id);

  if (!deleted) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
