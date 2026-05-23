import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { requireAuth } from "@/server/auth/http";
import { approveAndRunMyComputerOperation } from "@/server/my-computer/my-computer";
import type { MyComputerApprovalDecision } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validDecisions = new Set<MyComputerApprovalDecision>(["allow_once", "always", "deny"]);

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as {
    operationId?: string;
    decision?: MyComputerApprovalDecision;
  };
  const decision = body.decision ?? "allow_once";
  if (!body.operationId || !validDecisions.has(decision)) {
    return NextResponse.json({ error: "缺少 operationId 或授权决策不合法。" }, { status: 400 });
  }

  try {
    const operation = await approveAndRunMyComputerOperation({
      ownerId: user.id,
      operationId: body.operationId,
      decision
    });
    safeRecordAuditLog({
      userId: user.id,
      action: "my_computer.approval",
      resource: operation.target,
      status: operation.status === "completed" ? "completed" : operation.status === "blocked" ? "blocked" : "started",
      ...requestAuditContext(request),
      metadata: {
        operationId: operation.id,
        decision
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
