import { NextResponse } from "next/server";
import { readUser } from "@/server/auth/auth-store";
import {
  ownerIdFromMailbox,
  triggerInboundTask
} from "@/server/scheduled/scheduled-task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function integrationAuthorized(request: Request) {
  const token = process.env.MANUSXL_INTEGRATION_TOKEN?.trim();
  if (!token && process.env.NODE_ENV !== "production") return true;
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  return Boolean(token && bearer === token);
}

function recipientText(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(",");
  return String(value ?? "");
}

export async function POST(request: Request) {
  if (!integrationAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    to?: string | string[];
    from?: string;
    subject?: string;
    text?: string;
    html?: string;
    attachments?: Array<{ filename?: string; contentType?: string; size?: number }>;
  };
  const ownerId = ownerIdFromMailbox(recipientText(body.to));
  if (!ownerId) return NextResponse.json({ error: "无法从收件地址识别用户" }, { status: 400 });

  const user = readUser(ownerId);
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  const verifiedSender = String(body.from ?? "").trim().toLowerCase();
  if (
    process.env.MANUSXL_INTEGRATION_TOKEN &&
    verifiedSender &&
    verifiedSender !== user.email.toLowerCase()
  ) {
    return NextResponse.json({ error: "发件人与用户邮箱不匹配" }, { status: 403 });
  }

  const attachmentSummary = (body.attachments ?? [])
    .map((attachment) => `${attachment.filename ?? "attachment"} (${attachment.contentType ?? "unknown"}, ${attachment.size ?? 0} bytes)`)
    .join("\n");
  const prompt = [
    "Mail Manus 入站邮件触发任务。",
    `发件人：${body.from ?? "unknown"}`,
    `主题：${body.subject ?? "(无主题)"}`,
    "",
    body.text || body.html || "(无正文)",
    attachmentSummary ? `\n附件：\n${attachmentSummary}` : ""
  ].join("\n");
  const { task, log } = triggerInboundTask({
    ownerId,
    triggerType: "mail",
    source: `mail:${body.subject ?? "inbound"}`,
    prompt
  });

  return NextResponse.json({ taskId: task.id, log });
}
