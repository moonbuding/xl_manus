import { NextResponse } from "next/server";
import { cancelMyComputerDesktopTaskFromDevice } from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

export async function POST(
  request: Request,
  context: { params: { taskId: string } | Promise<{ taskId: string }> }
) {
  const { taskId } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const result = cancelMyComputerDesktopTaskFromDevice({
    token: bearerToken(request) ?? body.token,
    taskId
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
