import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { requireAuth } from "@/server/auth/http";
import { updateMyComputerSettings } from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as {
    allowedRoots?: string[];
    paused?: boolean;
  };
  const status = await updateMyComputerSettings({
    allowedRoots: body.allowedRoots,
    paused: body.paused
  });
  safeRecordAuditLog({
    userId: user.id,
    action: "my_computer.settings",
    resource: "my_computer",
    status: "completed",
    ...requestAuditContext(request),
    metadata: {
      allowedRootCount: body.allowedRoots?.length,
      paused: body.paused
    }
  });
  return NextResponse.json(status);
}
