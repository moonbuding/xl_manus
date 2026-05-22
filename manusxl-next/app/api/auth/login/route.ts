import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { authenticateUser } from "@/server/auth/auth-store";
import { jsonWithSession } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };

  try {
    const user = authenticateUser(body.email ?? "", body.password ?? "");
    safeRecordAuditLog({
      userId: user.id,
      action: "auth.login",
      resource: "email",
      status: "completed",
      ...requestAuditContext(request),
      metadata: { method: "email" }
    });
    return jsonWithSession({ user }, user.id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败" },
      { status: 401 }
    );
  }
}
