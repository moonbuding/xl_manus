import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { requireAuth } from "@/server/auth/http";
import { undoMyComputerFileOperation } from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as {
    operationId?: string;
  };

  try {
    const operation = await undoMyComputerFileOperation({
      ownerId: user.id,
      operationId: body.operationId
    });
    safeRecordAuditLog({
      userId: user.id,
      action: "my_computer.undo",
      resource: operation.target,
      status: operation.status === "completed" ? "completed" : "failed",
      ...requestAuditContext(request),
      metadata: {
        operationId: operation.id,
        sourceOperationId: operation.result?.sourceOperationId
      }
    });
    return NextResponse.json({ operation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
