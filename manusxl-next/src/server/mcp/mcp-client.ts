import { spawn } from "node:child_process";

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpStdioConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

interface JsonRpcMessage {
  id?: number | string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface McpClientSession {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): void;
  close(): Promise<void>;
}

function encodeMessage(message: unknown) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
    body
  ]);
}

function parseMessages(buffer: Buffer<ArrayBufferLike>) {
  const messages: unknown[] = [];
  let rest = buffer;

  while (rest.length > 0) {
    const headerEnd = rest.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;

    const header = rest.subarray(0, headerEnd).toString("utf8");
    const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error("MCP stdio 返回了无效 Content-Length。");
    }

    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (rest.length < bodyEnd) break;

    messages.push(JSON.parse(rest.subarray(bodyStart, bodyEnd).toString("utf8")));
    rest = rest.subarray(bodyEnd);
  }

  return { messages, rest };
}

function normalizeMcpTools(value: unknown): McpToolDefinition[] {
  const candidate = value as { tools?: unknown[] };
  if (!Array.isArray(candidate.tools)) return [];
  return candidate.tools
    .map((tool) => tool as { name?: unknown; description?: unknown; inputSchema?: unknown })
    .filter((tool) => typeof tool.name === "string" && tool.name.trim())
    .map((tool) => ({
      name: String(tool.name),
      description: typeof tool.description === "string" ? tool.description : undefined,
      inputSchema:
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? (tool.inputSchema as Record<string, unknown>)
          : undefined
    }));
}

async function openStdioSession(config: McpStdioConfig): Promise<McpClientSession> {
  const timeoutMs = config.timeoutMs ?? 8_000;
  const child = spawn(config.command, config.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(config.env ?? {})
    }
  });

  let nextId = 1;
  let stdoutBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr = "";
  let closed = false;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  const rejectAll = (error: Error) => {
    for (const [id, item] of pending.entries()) {
      clearTimeout(item.timer);
      pending.delete(id);
      item.reject(error);
    }
  };

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    try {
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
      const parsed = parseMessages(stdoutBuffer);
      stdoutBuffer = parsed.rest;

      for (const message of parsed.messages) {
        const rpc = message as JsonRpcMessage;
        if (rpc.id === undefined) continue;
        const item = pending.get(Number(rpc.id));
        if (!item) continue;
        clearTimeout(item.timer);
        pending.delete(Number(rpc.id));
        if (rpc.error) {
          item.reject(new Error(`MCP ${rpc.id} 错误：${rpc.error.message ?? "unknown error"}`));
        } else {
          item.resolve(rpc.result);
        }
      }
    } catch (error) {
      rejectAll(error instanceof Error ? error : new Error(String(error)));
    }
  });

  child.on("error", (error) => {
    closed = true;
    rejectAll(new Error(`MCP stdio 启动失败：${error.message}`));
  });

  child.on("exit", (code, signal) => {
    closed = true;
    if (pending.size > 0) {
      rejectAll(
        new Error(
          `MCP stdio 进程已退出：code=${code ?? "null"} signal=${signal ?? "null"}${stderr ? `，stderr=${stderr.slice(0, 500)}` : ""}`
        )
      );
    }
  });

  return {
    request(method, params = {}) {
      if (closed || !child.stdin?.writable) {
        return Promise.reject(new Error("MCP stdio 连接已关闭。"));
      }

      const id = nextId;
      nextId += 1;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP ${method} 超时。${stderr ? ` stderr=${stderr.slice(0, 500)}` : ""}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin?.write(
          encodeMessage({
            jsonrpc: "2.0",
            id,
            method,
            params
          })
        );
      });
    },
    notify(method, params = {}) {
      if (closed || !child.stdin?.writable) return;
      child.stdin.write(
        encodeMessage({
          jsonrpc: "2.0",
          method,
          params
        })
      );
    },
    async close() {
      closed = true;
      rejectAll(new Error("MCP stdio 连接已关闭。"));
      child.stdin?.end();
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 500);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
}

export async function listStdioMcpTools(config: McpStdioConfig) {
  const session = await openStdioSession(config);
  try {
    await session.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "manusxl",
        version: "0.1.0"
      }
    });
    session.notify("notifications/initialized");
    return normalizeMcpTools(await session.request("tools/list", {}));
  } finally {
    await session.close();
  }
}

export async function callStdioMcpTool(
  config: McpStdioConfig,
  toolName: string,
  args: Record<string, unknown>
) {
  const session = await openStdioSession(config);
  try {
    await session.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "manusxl",
        version: "0.1.0"
      }
    });
    session.notify("notifications/initialized");
    return await session.request("tools/call", {
      name: toolName,
      arguments: args
    });
  } finally {
    await session.close();
  }
}
