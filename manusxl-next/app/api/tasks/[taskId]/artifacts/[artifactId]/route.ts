import { existsSync, readFileSync } from "node:fs";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { canUserReadOrgTask } from "@/server/orgs/org-store";
import { getTask } from "@/server/tasks/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: {
    params:
      | { taskId: string; artifactId: string }
      | Promise<{ taskId: string; artifactId: string }>;
  }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { taskId, artifactId } = await Promise.resolve(context.params);
  const ownedTask = getTask(taskId, user.id);
  const sharedTask = ownedTask ? undefined : getTask(taskId);
  const task = ownedTask ?? (sharedTask && canUserReadOrgTask(user.id, taskId) ? sharedTask : undefined);
  const artifact = task?.artifacts.find((item) => item.id === artifactId);

  if (!artifact) {
    return new Response("Artifact not found", { status: 404 });
  }

  let body: BodyInit;

  if (artifact.filePath && existsSync(artifact.filePath)) {
    body = readFileSync(artifact.filePath);
  } else if (artifact.content !== undefined) {
    body =
      artifact.contentEncoding === "base64"
        ? Buffer.from(artifact.content, "base64")
        : artifact.content;
  } else {
    return new Response("Artifact file missing", { status: 404 });
  }

  return new Response(body, {
    headers: {
      "Content-Disposition": `attachment; filename="${artifact.name}"`,
      "Content-Type": artifact.mimeType
    }
  });
}
