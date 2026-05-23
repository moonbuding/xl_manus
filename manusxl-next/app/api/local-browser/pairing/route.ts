import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import {
  createLocalBrowserPairingCode,
  getLocalBrowserPairingStatus
} from "@/server/local-browser/pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(getLocalBrowserPairingStatus(user.id));
}

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(createLocalBrowserPairingCode(user.id));
}
