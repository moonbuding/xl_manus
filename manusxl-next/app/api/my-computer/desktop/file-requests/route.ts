import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import {
  listMyComputerDesktopFileRequests,
  requestMyComputerDesktopFileUpload
} from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ requests: listMyComputerDesktopFileRequests(user.id) });
}

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as {
    requestedPath?: string;
    reason?: string;
    deviceId?: string;
  };
  const result = requestMyComputerDesktopFileUpload({
    ownerId: user.id,
    requestedPath: body.requestedPath,
    reason: body.reason,
    deviceId: body.deviceId
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
