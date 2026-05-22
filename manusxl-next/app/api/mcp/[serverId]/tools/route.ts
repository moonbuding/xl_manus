import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listMcpServers, refreshMcpServerTools } from "@/server/mcp/mcp-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: { serverId: string } | Promise<{ serverId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();

  const { serverId } = await Promise.resolve(context.params);
  const server = await refreshMcpServerTools(serverId, user.id);
  if (!server) return NextResponse.json({ error: "MCP Server not found" }, { status: 404 });

  return NextResponse.json({ server, servers: listMcpServers(user.id) });
}
