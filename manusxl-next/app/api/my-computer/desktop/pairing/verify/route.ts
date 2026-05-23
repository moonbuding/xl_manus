import { NextResponse } from "next/server";
import { verifyMyComputerDesktopPairingCode } from "@/server/my-computer/my-computer";
import type { MyComputerBridgeType, MyComputerOperationKind } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    deviceName?: string;
    bridge?: MyComputerBridgeType;
    platform?: string;
    appVersion?: string;
    capabilities?: MyComputerOperationKind[];
    metadata?: Record<string, string | number | boolean>;
  };
  const result = verifyMyComputerDesktopPairingCode(body);
  return NextResponse.json(result, { status: result.paired ? 200 : 409 });
}
