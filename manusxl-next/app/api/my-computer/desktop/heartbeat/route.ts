import { NextResponse } from "next/server";
import { heartbeatMyComputerDesktopDevice } from "@/server/my-computer/my-computer";
import type { MyComputerOperationKind } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    capabilities?: MyComputerOperationKind[];
    appVersion?: string;
    platform?: string;
    metadata?: Record<string, string | number | boolean>;
  };
  const result = await heartbeatMyComputerDesktopDevice({
    ...body,
    token: bearerToken(request) ?? body.token
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 401 });
}
