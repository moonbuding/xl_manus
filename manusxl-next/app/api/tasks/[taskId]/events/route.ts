import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { getTask, subscribeToTask } from "@/server/tasks/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeEvent(data: { id?: string }) {
  const eventId = data.id ? `id: ${data.id}\n` : "";
  return `${eventId}event: agent_event\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: Request,
  context: { params: { taskId: string } | Promise<{ taskId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { taskId } = await Promise.resolve(context.params);
  const task = getTask(taskId, user.id);

  if (!task) {
    return new Response("Task not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const url = new URL(request.url);
  const lastEventId =
    url.searchParams.get("lastEventId") ?? request.headers.get("last-event-id") ?? undefined;
  const lastEventIndex = lastEventId
    ? task.events.findIndex((event) => event.id === lastEventId)
    : -1;
  const replayEvents = lastEventIndex >= 0 ? task.events.slice(lastEventIndex + 1) : task.events;

  const stream = new ReadableStream({
    start(controller) {
      const send = (value: string) => controller.enqueue(encoder.encode(value));
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      replayEvents.forEach((event) => send(encodeEvent(event)));
      const lastReplayEvent = replayEvents.at(-1);
      if (lastReplayEvent?.type === "finished" || lastReplayEvent?.type === "failed") {
        close();
        return;
      }

      const unsubscribe = subscribeToTask(taskId, (event) => {
        if (closed) return;
        send(encodeEvent(event));
        if (event.type === "finished" || event.type === "failed") {
          unsubscribe();
          close();
        }
      });

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8"
    }
  });
}
