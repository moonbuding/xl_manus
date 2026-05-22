import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import { screenshotLocalBrowserTab } from "@/server/local-browser/cdp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: string;
    tabId?: string;
    format?: "jpeg" | "png";
    quality?: number;
  };
  const screenshot = await screenshotLocalBrowserTab({
    ...body,
    ownerId: user.id,
    source: "settings"
  });
  return NextResponse.json(screenshot, { status: screenshot.ok ? 200 : 409 });
}
