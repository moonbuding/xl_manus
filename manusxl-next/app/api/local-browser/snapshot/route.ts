import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import { snapshotLocalBrowserTab } from "@/server/local-browser/cdp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: string;
    tabId?: string;
    maxChars?: number;
  };
  const snapshot = await snapshotLocalBrowserTab(body);
  return NextResponse.json(snapshot, { status: snapshot.ok ? 200 : 409 });
}
