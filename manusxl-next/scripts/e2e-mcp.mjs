const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const phone = process.env.MANUSXL_E2E_PHONE ?? "18800000001";
const cookieJar = new Map();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function rememberCookies(headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return;
  raw
    .split(/,\s*(?=[^;]+=)/)
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .forEach((cookie) => {
      const separator = cookie.indexOf("=");
      if (separator > 0) cookieJar.set(cookie.slice(0, separator), cookie.slice(separator + 1));
    });
}

function headers(input = {}) {
  const next = new Headers(input);
  const cookies = [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookies) next.set("Cookie", cookies);
  return next;
}

async function json(pathname, init = {}) {
  const response = await fetch(url(pathname), {
    ...init,
    headers: headers(init.headers)
  });
  rememberCookies(response.headers);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  assert(response.ok, `${pathname} failed: ${response.status} ${text}`);
  return body;
}

async function requestJson(pathname, init = {}) {
  const response = await fetch(url(pathname), {
    ...init,
    headers: headers(init.headers)
  });
  rememberCookies(response.headers);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body };
}

async function waitForTask(taskId) {
  const response = await fetch(url(`/api/tasks/${taskId}/events`), { headers: headers() });
  rememberCookies(response.headers);
  assert(response.ok, `SSE failed: ${response.status}`);
  assert(response.body, "SSE stream is not readable");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) {
        const event = JSON.parse(data);
        events.push(event);
        if (event.type === "finished") return events;
        if (event.type === "failed") throw new Error(event.content ?? "MCP task failed");
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  return events;
}

async function login() {
  const requested = await json("/api/auth/phone/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
  await json("/api/auth/phone/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code: requested.verificationCode })
  });
}

async function main() {
  console.log(`MCP E2E base URL: ${baseUrl}`);
  await login();

  const created = await json("/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "mock stdio",
      type: "stdio",
      command: "node",
      args: ["scripts/mock-mcp-stdio.mjs"]
    })
  });

  const server = created.server;
  assert(server?.id, "MCP server was not created");
  assert(server.status === "healthy", `MCP server is not healthy: ${server.statusMessage}`);
  assert(server.tools.includes("echo_context"), "MCP tools/list did not discover echo_context");
  console.log(`已接入 MCP：${server.name}，工具：${server.tools.join(", ")}`);

  const refreshed = await json(`/api/mcp/${server.id}/tools`, { method: "POST" });
  assert(refreshed.server.tools.includes("list_directory"), "MCP tools refresh failed");

  const called = await json(`/api/mcp/${server.id}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolName: "echo_context",
      arguments: {
        step: "MCP integration test"
      }
    })
  });
  const content = JSON.stringify(called.result);
  assert(content.includes("MCP integration test"), "MCP tool call did not return expected content");
  console.log("MCP 工具调用通过。");

  const disabled = await json("/api/mcp", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serverId: server.id,
      toolName: "echo_context",
      toolEnabled: false
    })
  });
  assert(disabled.server.disabledTools.includes("echo_context"), "MCP tool disable did not persist");

  const rejected = await requestJson(`/api/mcp/${server.id}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolName: "echo_context",
      arguments: { step: "should be rejected" }
    })
  });
  assert(rejected.response.status === 400, "Disabled MCP tool call should be rejected");

  const reenabled = await json("/api/mcp", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serverId: server.id,
      toolName: "echo_context",
      toolEnabled: true
    })
  });
  assert(!reenabled.server.disabledTools.includes("echo_context"), "MCP tool re-enable did not persist");
  console.log("MCP 工具级启停通过。");

  const createdTask = await json("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "使用 MCP echo_context 工具回显当前任务，然后输出一句总结。"
    })
  });
  const events = await waitForTask(createdTask.taskId);
  assert(
    events.some((event) => event.type === "tool_call" && event.payload?.toolName === "mcp_call"),
    "Agent task did not call mcp_call"
  );
  assert(
    events.some(
      (event) =>
        event.type === "tool_result" &&
        (event.title?.includes("mcp_call") || JSON.stringify(event.payload).includes("mcp_call")) &&
        JSON.stringify(event).includes("mock echo")
    ),
    "Agent mcp_call did not return mock MCP result"
  );
  console.log("Agent MCP 调用通过。");

  await json("/api/mcp", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId: server.id })
  });
  console.log("MCP E2E 验收完成。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
