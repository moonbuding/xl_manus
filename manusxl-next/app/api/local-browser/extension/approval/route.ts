import { NextResponse } from "next/server";
import { decideLocalBrowserApprovalRequest } from "@/server/local-browser/audit";
import {
  getLocalBrowserExtensionState,
  resolveLocalBrowserPairingToken
} from "@/server/local-browser/pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    approvalId?: string;
    approved?: boolean;
  };
  const device = resolveLocalBrowserPairingToken(body.token);
  if (!device) {
    return NextResponse.json(
      { paired: false, error: "扩展尚未配对或令牌已失效。" },
      { status: 401 }
    );
  }

  const decision = decideLocalBrowserApprovalRequest({
    ownerId: device.ownerId,
    approvalId: body.approvalId,
    approved: body.approved === true
  });
  if (!decision.ok) {
    return NextResponse.json(
      {
        paired: true,
        device: getLocalBrowserExtensionState(body.token).device,
        error: decision.error,
        approval: decision.approval
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    paired: true,
    device: getLocalBrowserExtensionState(body.token).device,
    approval: decision.approval,
    safety: getLocalBrowserExtensionState(body.token).safety
  });
}
