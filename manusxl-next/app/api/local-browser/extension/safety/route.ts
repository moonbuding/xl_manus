import { NextResponse } from "next/server";
import {
  getLocalBrowserExtensionState,
  resolveLocalBrowserPairingToken
} from "@/server/local-browser/pairing";
import {
  recordLocalBrowserOperation,
  setLocalBrowserPaused
} from "@/server/local-browser/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: string; paused?: boolean };
  const device = resolveLocalBrowserPairingToken(body.token);
  if (!device) {
    return NextResponse.json(
      { paired: false, error: "扩展尚未配对或令牌已失效。" },
      { status: 401 }
    );
  }

  const paused = Boolean(body.paused);
  recordLocalBrowserOperation({
    ownerId: device.ownerId,
    source: "settings",
    action: "status",
    status: paused ? "blocked" : "completed",
    title: paused ? `${device.name} 暂停本地浏览器操作` : `${device.name} 恢复本地浏览器操作`
  });
  const safety = setLocalBrowserPaused(paused);
  return NextResponse.json({
    paired: true,
    device: getLocalBrowserExtensionState(body.token).device,
    safety
  });
}
