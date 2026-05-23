const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 120000);
const cookieJar = new Map();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function mergeHeaders(headers = {}) {
  const merged = new Headers(headers);
  const cookies = cookieHeader();
  if (cookies) merged.set("Cookie", cookies);
  return merged;
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
      if (separator <= 0) return;
      cookieJar.set(cookie.slice(0, separator), cookie.slice(separator + 1));
    });
}

async function fetchJson(pathname, init) {
  const response = await fetch(url(pathname), {
    ...init,
    headers: mergeHeaders(init?.headers)
  });
  rememberCookies(response.headers);
  const body = await response.text();
  let parsed;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    parsed = body;
  }
  assert(response.ok, `${pathname} 请求失败：${response.status} ${body}`);
  return parsed;
}

async function loginForE2E() {
  const phone = `188${String(Date.now()).slice(-8)}`;
  const requested = await fetchJson("/api/auth/phone/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
  assert(requested.verificationCode, "开发验证码没有返回");

  const verified = await fetchJson("/api/auth/phone/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code: requested.verificationCode })
  });
  assert(verified.user?.id, "手机号登录没有返回用户信息");
  console.log(`已登录 Wide Research E2E 用户：${verified.user.phone ?? phone}`);
}

async function waitForTask(taskId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url(`/api/tasks/${taskId}/events`), {
    headers: mergeHeaders(),
    signal: controller.signal
  });
  rememberCookies(response.headers);
  assert(response.ok, `SSE 连接失败：${response.status}`);
  assert(response.body, "当前 Node 版本不支持读取 SSE stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";

  try {
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
          process.stdout.write(`· ${event.type}: ${event.title ?? "Agent event"}\n`);
          if (event.type === "finished") return events;
          if (event.type === "failed") throw new Error(`任务失败：${event.content ?? "unknown error"}`);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }

  return events;
}

async function downloadArtifact(taskId, artifactId) {
  const response = await fetch(url(`/api/tasks/${taskId}/artifacts/${artifactId}`), {
    headers: mergeHeaders()
  });
  assert(response.ok, `下载 artifact 失败：${response.status}`);
  return response.text();
}

async function main() {
  console.log(`ManusXL Wide Research E2E base URL: ${baseUrl}`);
  await loginForE2E();

  const config = await fetchJson("/api/config");
  const marker = `wide-research-e2e-${Date.now()}`;
  const companies = Array.from({ length: 49 }, (_, index) => `公司${String(index + 1).padStart(2, "0")}`);
  companies.push("失败样本");
  const prompt = [
    `Wide Research 验收 ${marker}：并行调研以下 50 家公司：`,
    `${companies.join("、")}。`,
    "请输出结构化汇总，并验证单个子 Agent 失败不会阻塞主 Agent。"
  ].join("");
  const created = await fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      model: config.model
    })
  });
  assert(created.taskId, "创建任务没有返回 taskId");
  console.log(`任务已创建：${created.taskId}`);

  const events = await waitForTask(created.taskId);
  const toolCall = events.find((event) => event.type === "tool_call" && event.title === "spawn_sub_agents");
  assert(toolCall, "缺少 spawn_sub_agents 工具调用");

  const progress = events.filter(
    (event) => event.type === "message" && event.payload?.progress?.tool === "spawn_sub_agents"
  );
  assert(progress.length >= 2, "缺少 Wide Research 进度事件");

  const toolResult = events.find(
    (event) => event.type === "tool_result" && event.title === "spawn_sub_agents 结果"
  );
  assert(toolResult?.payload?.wideResearch, "缺少 Wide Research 工具结果 payload");
  assert(toolResult.payload.wideResearch.actualCount >= 50, "子 Agent 启动数量不足");
  assert(toolResult.payload.wideResearch.completed >= 49, "完成的子 Agent 数不足");
  assert(toolResult.payload.wideResearch.skipped >= 1, "没有验证失败跳过策略");
  assert(toolResult.payload.wideResearch.concurrencyLimit >= 1, "缺少并发池信息");

  const task = await fetchJson(`/api/tasks/${created.taskId}`);
  const artifactNames = task.artifacts.map((artifact) => artifact.name);
  for (const name of [
    "wide-research-report.md",
    "wide-research-results.json",
    "wide-research-results.csv",
    "wide-research-package.zip"
  ]) {
    assert(artifactNames.includes(name), `缺少交付物：${name}`);
  }

  const jsonArtifact = task.artifacts.find((artifact) => artifact.name === "wide-research-results.json");
  const json = JSON.parse(await downloadArtifact(created.taskId, jsonArtifact.id));
  assert(json.results.length >= 50, "Wide Research JSON 结果数量不足");
  assert(json.results.some((result) => result.status === "skipped"), "JSON 中缺少跳过的子 Agent");

  console.log(
    JSON.stringify(
      {
        ok: true,
        taskId: created.taskId,
        subAgents: json.results.length,
        completed: json.completed,
        skipped: json.skipped,
        concurrencyLimit: json.concurrencyLimit
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
