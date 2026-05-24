import { NextResponse } from "next/server";
import { enqueueAgentTask } from "@/server/agent/scheduler";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listUploadedFileRecords } from "@/server/files/readers";
import {
  dispatchTaskToMyComputerDesktop,
  hasOnlineMyComputerDesktop
} from "@/server/my-computer/my-computer";
import { continueTaskConversation, getTask } from "@/server/tasks/task-store";
import type { CreateTaskRequest } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: { taskId: string } | Promise<{ taskId: string }> }
) {
  try {
    const user = currentUserFromRequest(request);
    if (!user) return unauthorized();
    const { taskId } = await Promise.resolve(context.params);
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

    const existingTask = getTask(taskId, user.id);
    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (existingTask.executionTarget === "my-computer" && !hasOnlineMyComputerDesktop(user.id)) {
      return NextResponse.json({ error: "没有在线的 My Computer 桌面端设备" }, { status: 409 });
    }

    const result = continueTaskConversation(taskId, user.id, prompt, {
      model: body.model,
      uploadedFileIds: uploadedFileRecords.map((file) => file.id)
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const task = result.task;
    safeRecordAuditLog({
      userId: user.id,
      taskId: task.id,
      action: "task.continue",
      resource: `task:${task.id}`,
      status: "completed",
      ...requestAuditContext(request),
      metadata: {
        model: task.model,
        promptLength: prompt.length,
        uploadedFileCount: uploadedFileRecords.length,
        executionTarget: task.executionTarget
      }
    });

    const desktopDispatch =
      task.executionTarget === "my-computer"
        ? dispatchTaskToMyComputerDesktop({ taskId: task.id, ownerId: user.id })
        : undefined;
    if (desktopDispatch && !desktopDispatch.ok) {
      return NextResponse.json({ error: desktopDispatch.error }, { status: desktopDispatch.status });
    }
    const queue = task.executionTarget === "my-computer" ? undefined : enqueueAgentTask(task.id);

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      queue,
      desktopDispatch
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Continue task failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
