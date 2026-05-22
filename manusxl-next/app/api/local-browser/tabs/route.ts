import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import { listLocalBrowserTabs } from "@/server/local-browser/cdp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(await listLocalBrowserTabs());
}

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
  return NextResponse.json(await listLocalBrowserTabs(body.endpoint));
}
