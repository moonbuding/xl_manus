import { NextResponse } from "next/server";
import { verifyLocalBrowserPairingCode } from "@/server/local-browser/pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    deviceName?: string;
    extensionId?: string;
  };
  const result = verifyLocalBrowserPairingCode(body);
  return NextResponse.json(result, { status: result.paired ? 200 : 409 });
}
