import { NextResponse } from "next/server";
import { completeMyComputerDesktopTask } from "@/server/my-computer/my-computer";

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
    ok?: boolean;
    finalAnswer?: string;
    error?: string;
    artifacts?: Array<{
      name: string;
      type: "txt" | "md" | "json";
      mimeType: string;
      content: string;
    }>;
  };
  const result = completeMyComputerDesktopTask({
    token: bearerToken(request) ?? body.token,
    taskId,
    ok: body.ok !== false,
    finalAnswer: body.finalAnswer,
    error: body.error,
    artifacts: body.artifacts
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
