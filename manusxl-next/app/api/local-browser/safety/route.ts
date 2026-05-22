import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import {
  getLocalBrowserSafetyState,
  recordLocalBrowserOperation,
  setLocalBrowserPaused
} from "@/server/local-browser/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(getLocalBrowserSafetyState());
}

export async function PATCH(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as { paused?: boolean };
  const paused = Boolean(body.paused);
  recordLocalBrowserOperation({
    ownerId: user.id,
    source: "settings",
    action: "status",
    status: paused ? "blocked" : "completed",
    title: paused ? "用户暂停本地浏览器操作" : "用户恢复本地浏览器操作"
  });
  return NextResponse.json(setLocalBrowserPaused(paused));
}
