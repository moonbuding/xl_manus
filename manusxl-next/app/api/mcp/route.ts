import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  updateMcpServerEnabled,
  updateMcpServerToolEnabled
} from "@/server/mcp/mcp-registry";
import type { CreateMcpServerRequest } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return NextResponse.json({ servers: listMcpServers(user.id) });
}

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json()) as Partial<CreateMcpServerRequest>;
  try {
    const server = await createMcpServer(body, user.id);
    return NextResponse.json({ server, servers: listMcpServers(user.id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "MCP Server 创建失败" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json()) as {
    serverId?: string;
    enabled?: boolean;
    toolName?: string;
    toolEnabled?: boolean;
  };
  if (!body.serverId) {
    return NextResponse.json({ error: "serverId is required" }, { status: 400 });
  }
  const server =
    body.toolName && typeof body.toolEnabled === "boolean"
      ? updateMcpServerToolEnabled(body.serverId, body.toolName, body.toolEnabled, user.id)
      : typeof body.enabled === "boolean"
        ? updateMcpServerEnabled(body.serverId, body.enabled, user.id)
        : undefined;
  if (!server) return NextResponse.json({ error: "MCP Server not found" }, { status: 404 });
  return NextResponse.json({ server, servers: listMcpServers(user.id) });
}

export async function DELETE(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json()) as { serverId?: string };
  if (!body.serverId) {
    return NextResponse.json({ error: "serverId is required" }, { status: 400 });
  }
  const deleted = deleteMcpServer(body.serverId, user.id);
  if (!deleted) return NextResponse.json({ error: "MCP Server not found" }, { status: 404 });
  return NextResponse.json({ ok: true, servers: listMcpServers(user.id) });
}
