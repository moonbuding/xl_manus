const tools = [
  {
    name: "echo_context",
    description: "Echo prompt and step for ManusXL MCP integration tests.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        step: { type: "string" },
        taskId: { type: "string" }
      }
    }
  },
  {
    name: "list_directory",
    description: "Return a deterministic mock directory listing.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      }
    }
  }
];

let buffer = Buffer.alloc(0);

function encode(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

function parseMessages() {
  const messages = [];
  while (buffer.length > 0) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
    if (!Number.isFinite(length)) throw new Error("Invalid Content-Length");
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) break;
    messages.push(JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf8")));
    buffer = buffer.subarray(bodyEnd);
  }
  return messages;
}

function resultFor(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "manusxl-mock-mcp",
        version: "0.1.0"
      }
    };
  }
  if (message.method === "tools/list") {
    return { tools };
  }
  if (message.method === "tools/call") {
    const toolName = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (toolName === "list_directory") {
      return {
        content: [
          {
            type: "text",
            text: `mock list for ${args.path ?? "."}: README.md, package.json, src/`
          }
        ]
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `mock echo: ${args.step ?? args.prompt ?? "empty"}`
        }
      ]
    };
  }
  return {};
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (const message of parseMessages()) {
    if (message.id === undefined) continue;
    process.stdout.write(
      encode({
        jsonrpc: "2.0",
        id: message.id,
        result: resultFor(message)
      })
    );
  }
});
