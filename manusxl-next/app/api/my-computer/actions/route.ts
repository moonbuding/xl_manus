import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import { createMyComputerSystemOperation } from "@/server/my-computer/my-computer";
import type { MyComputerApprovalDecision, MyComputerOperationKind } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const systemKinds = new Set<MyComputerOperationKind>([
  "app_launch",
  "app_quit",
  "clipboard_write",
  "clipboard_read",
  "keyboard_shortcut",
  "mouse_click",
  "terminal_command"
]);

export async function POST(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => ({}))) as {
    kind?: MyComputerOperationKind;
    target?: string;
    text?: string;
    command?: string;
    args?: string[];
    x?: number;
    y?: number;
    dryRun?: boolean;
    decision?: MyComputerApprovalDecision;
  };
  if (!body.kind || !systemKinds.has(body.kind)) {
    return NextResponse.json({ error: "不支持的 My Computer 系统动作。" }, { status: 400 });
  }

  try {
    const operation = await createMyComputerSystemOperation({
      ownerId: user.id,
      kind: body.kind as
        | "app_launch"
        | "app_quit"
        | "clipboard_write"
        | "clipboard_read"
        | "keyboard_shortcut"
        | "mouse_click"
        | "terminal_command",
      target: body.target,
      text: body.text,
      command: body.command,
      args: body.args,
      x: body.x,
      y: body.y,
      dryRun: body.dryRun,
      decision: body.decision
    });
    return NextResponse.json({ operation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
