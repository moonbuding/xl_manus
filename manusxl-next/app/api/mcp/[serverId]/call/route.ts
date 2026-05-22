import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { callMcpServerTool } from "@/server/mcp/mcp-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: { serverId: string } | Promise<{ serverId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();

  const { serverId } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as {
    toolName?: string;
    arguments?: Record<string, unknown>;
  };
  if (!body.toolName) {
    return NextResponse.json({ error: "toolName is required" }, { status: 400 });
  }

  try {
    const result = await callMcpServerTool(
      serverId,
      body.toolName,
      body.arguments ?? {},
      user.id
    );
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "MCP 工具调用失败" },
      { status: 400 }
    );
  }
}
