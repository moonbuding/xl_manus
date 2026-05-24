import { NextResponse } from "next/server";
import { disconnectMyComputerDesktopDeviceByToken } from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const result = disconnectMyComputerDesktopDeviceByToken(bearerToken(request) ?? body.token);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
