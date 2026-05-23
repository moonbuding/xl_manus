import { NextResponse } from "next/server";
import { getLocalBrowserExtensionState } from "@/server/local-browser/pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const result = getLocalBrowserExtensionState(body.token);
  return NextResponse.json(result, { status: result.paired ? 200 : 401 });
}
