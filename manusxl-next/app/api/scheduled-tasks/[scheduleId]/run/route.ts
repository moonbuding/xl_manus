import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { runScheduledTask } from "@/server/scheduled/scheduled-task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ scheduleId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { scheduleId } = await context.params;

  try {
    const log = runScheduledTask(scheduleId, user.id, "manual");
    return NextResponse.json({ log });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Run scheduled task failed" },
      { status: 400 }
    );
  }
}
