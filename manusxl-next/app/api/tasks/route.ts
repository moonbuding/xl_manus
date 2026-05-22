import { NextResponse } from "next/server";
import { enqueueAgentTask } from "@/server/agent/scheduler";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listUploadedFileRecords } from "@/server/files/readers";
import { getDeepSeekConfig } from "@/server/llm/deepseek";
import { createTask, listTasks } from "@/server/tasks/task-store";
import type { CreateTaskRequest } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  return NextResponse.json({ tasks: listTasks(url.searchParams.get("q") ?? undefined, user.id) });
}

export async function POST(request: Request) {
  try {
    const user = currentUserFromRequest(request);
    if (!user) return unauthorized();
    const body = (await request.json()) as Partial<CreateTaskRequest>;
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const requestedFileIds = Array.isArray(body.fileIds)
      ? body.fileIds.map((fileId) => String(fileId).trim()).filter(Boolean)
      : [];
    const uploadedFileRecords =
      requestedFileIds.length > 0 ? listUploadedFileRecords(user.id, requestedFileIds) : [];

    if (uploadedFileRecords.length !== new Set(requestedFileIds).size) {
      return NextResponse.json({ error: "部分上传文件不存在或不属于当前用户" }, { status: 400 });
    }

    const model = body.model?.trim() || getDeepSeekConfig().model;
    const task = createTask(
      prompt,
      model,
      user.id,
      uploadedFileRecords.map((file) => file.id)
    );
    safeRecordAuditLog({
      userId: user.id,
      taskId: task.id,
      action: "task.create",
      resource: `task:${task.id}`,
      status: "completed",
      ...requestAuditContext(request),
      metadata: {
        model,
        promptLength: prompt.length,
        uploadedFileCount: uploadedFileRecords.length,
        queued: true
      }
    });
    const queue = enqueueAgentTask(task.id);

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      queue
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Create task failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
