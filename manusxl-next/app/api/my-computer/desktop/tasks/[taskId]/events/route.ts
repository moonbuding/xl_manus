import { NextResponse } from "next/server";
import { appendMyComputerDesktopTaskEvent } from "@/server/my-computer/my-computer";
import type { AgentEventType } from "@/types/agent";

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
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    type?: AgentEventType;
    title?: string;
    content?: string;
    payload?: unknown;
  };
  const result = appendMyComputerDesktopTaskEvent({
    token: bearerToken(request) ?? body.token,
    taskId,
    type: body.type,
    title: body.title,
    content: body.content,
    payload: body.payload
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
