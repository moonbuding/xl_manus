import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listOrgTaskShares } from "@/server/orgs/org-store";
import { listTasks } from "@/server/tasks/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  context: { params: { orgId: string } | Promise<{ orgId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return Promise.resolve(context.params).then(({ orgId }) => {
    const result = listOrgTaskShares(orgId, user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const sharesByTaskId = new Map(result.shares.map((share) => [share.taskId, share]));
    const tasks = listTasks()
      .filter((task) => sharesByTaskId.has(task.id))
      .map((task) => ({
        ...task,
        organizationShare: sharesByTaskId.get(task.id)
      }));
    return NextResponse.json({ tasks, role: result.membership.role });
  });
}
