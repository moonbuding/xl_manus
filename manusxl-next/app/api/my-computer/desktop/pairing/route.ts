import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { requireAuth } from "@/server/auth/http";
import {
  createMyComputerDesktopPairingCode,
  getMyComputerDesktopPairingStatus
} from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(getMyComputerDesktopPairingStatus(user.id));
}

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const status = createMyComputerDesktopPairingCode(user.id);
  safeRecordAuditLog({
    userId: user.id,
    action: "my_computer.desktop_pairing.create",
    resource: "my_computer_desktop",
    status: "completed",
    ...requestAuditContext(request),
    metadata: {
      expiresAt: status.activeCode?.expiresAt
    }
  });
  return NextResponse.json(status);
}
