import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { verifyEmail } from "@/server/auth/auth-store";
import { jsonWithSession } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; code?: string; verificationCode?: string };

  try {
    const user = verifyEmail({
      email: body.email ?? "",
      code: body.code ?? body.verificationCode ?? ""
    });
    safeRecordAuditLog({
      userId: user.id,
      action: "auth.email_verify",
      resource: "email",
      status: "completed",
      ...requestAuditContext(request),
      metadata: { email: user.email }
    });
    return jsonWithSession({ user }, user.id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "验证失败" },
      { status: 400 }
    );
  }
}
