import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import { runLocalBrowserAction } from "@/server/local-browser/cdp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: string;
    tabId?: string;
    action?: string;
    url?: string;
    x?: number;
    y?: number;
    text?: string;
    key?: string;
    waitMs?: number;
  };
  const result = await runLocalBrowserAction({
    ...body,
    ownerId: user.id,
    source: "settings"
  });
  const status = result.action === "unknown" ? 400 : result.ok ? 200 : 409;
  return NextResponse.json(result, { status });
}
