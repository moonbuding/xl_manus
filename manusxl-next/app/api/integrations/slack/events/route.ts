import { NextResponse } from "next/server";
import { readUser } from "@/server/auth/auth-store";
import { triggerInboundTask } from "@/server/scheduled/scheduled-task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function integrationAuthorized(request: Request) {
  const token = process.env.MANUSXL_INTEGRATION_TOKEN?.trim();
  if (!token && process.env.NODE_ENV !== "production") return true;
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  return Boolean(token && bearer === token);
}

function textWithoutMention(value: string) {
  return value.replace(/<@[^>]+>/g, "").replace(/@xl-manus/gi, "").trim();
}

export async function POST(request: Request) {
  if (!integrationAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    type?: string;
    challenge?: string;
    ownerId?: string;
    text?: string;
    team?: string;
    channel?: string;
    user?: string;
    event?: {
      type?: string;
      text?: string;
      channel?: string;
      user?: string;
      team?: string;
    };
  };

  if (body.type === "url_verification" && body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }

  const ownerId = body.ownerId || process.env.MANUSXL_SLACK_DEFAULT_USER_ID;
  if (!ownerId) return NextResponse.json({ error: "缺少 ownerId 或 MANUSXL_SLACK_DEFAULT_USER_ID" }, { status: 400 });
  const user = readUser(ownerId);
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  const text = textWithoutMention(body.event?.text ?? body.text ?? "");
  if (!text) return NextResponse.json({ error: "Slack 消息为空" }, { status: 400 });

  const channel = body.event?.channel ?? body.channel ?? "dm";
  const slackUser = body.event?.user ?? body.user ?? "unknown";
  const prompt = [
    "Manus for Slack 触发任务。",
    `Slack 用户：${slackUser}`,
    `频道：${channel}`,
    "",
    text
  ].join("\n");
  const { task, log } = triggerInboundTask({
    ownerId: user.id,
    triggerType: "slack",
    source: `slack:${channel}`,
    prompt
  });

  return NextResponse.json({ taskId: task.id, log });
}
