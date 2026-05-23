import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClient(phone) {
  const cookieJar = new Map();

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

  async function fetchJson(pathname, init, allowError = false) {
    const response = await fetch(url(pathname), {
      ...init,
      headers: mergeHeaders(init?.headers)
    });
    rememberCookies(response.headers);
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = text;
    }
    if (!allowError) assert(response.ok, `${pathname} 请求失败：${response.status} ${text}`);
    return { response, body };
  }

  async function fetchText(pathname, init, allowError = false) {
    const response = await fetch(url(pathname), {
      ...init,
      headers: mergeHeaders(init?.headers)
    });
    rememberCookies(response.headers);
    const text = await response.text();
    if (!allowError) assert(response.ok, `${pathname} 请求失败：${response.status} ${text}`);
    return { response, text };
  }

  async function login() {
    const requested = await fetchJson("/api/auth/phone/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    assert(requested.body.verificationCode, "开发验证码没有返回");
    const verified = await fetchJson("/api/auth/phone/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code: requested.body.verificationCode })
    });
    assert(verified.body.user?.id, "手机号登录没有返回用户信息");
  }

  return { fetchJson, fetchText, login };
}

async function waitForTask(client, taskId) {
  const terminal = new Set(["completed", "failed", "cancelled", "timeout"]);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    const task = (await client.fetchJson(`/api/tasks/${taskId}`)).body;
    if (terminal.has(task.status)) return task;
    await wait(800);
  }
  throw new Error(`等待任务结束超时：${taskId}`);
}

async function waitForAuditAction(client, action, taskId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    const query = taskId ? `?action=${encodeURIComponent(action)}&taskId=${encodeURIComponent(taskId)}` : `?action=${encodeURIComponent(action)}`;
    const logs = (await client.fetchJson(`/api/audit/logs${query}`)).body;
    if (logs.logs?.length > 0) return logs.logs[0];
    await wait(500);
  }
  throw new Error(`没有等到审计日志：${action}`);
}

function assertSqliteAppendOnlyTrigger(logId) {
  const dbPath = join(process.cwd(), ".manusxl-data", "manusxl.sqlite");
  if (!existsSync(dbPath)) return false;
  const db = new DatabaseSync(dbPath);
  try {
    const expectBlocked = (sql, action) => {
      let blockedError;
      db.exec("BEGIN");
      try {
        db.prepare(sql).run(logId);
      } catch (error) {
        blockedError = error;
      } finally {
        try {
          db.exec("ROLLBACK");
        } catch {
          // The trigger should leave the transaction open, but rollback is best-effort.
        }
      }
      if (!blockedError) throw new Error(`审计日志 ${action} 没有被 append-only trigger 拦截`);
      assert(
        String(blockedError?.message ?? blockedError).includes("append-only"),
        `审计日志 ${action} trigger 错误信息不正确`
      );
    };

    expectBlocked("UPDATE audit_logs SET action = action WHERE id = ?", "UPDATE");
    expectBlocked("DELETE FROM audit_logs WHERE id = ?", "DELETE");
    return true;
  } finally {
    db.close();
  }
}

async function main() {
  console.log(`ManusXL audit E2E base URL: ${baseUrl}`);

  const anonymousLogs = await fetch(url("/api/audit/logs"));
  assert(anonymousLogs.status === 401, "未登录访问审计日志应返回 401");

  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();
  const loginLog = await waitForAuditAction(client, "auth.login");
  assert(loginLog.resource === "phone", "手机号登录审计日志 resource 不正确");

  const configPatch = await client.fetchJson("/api/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ promptCacheEnabled: true })
  });
  assert(configPatch.body.promptCacheEnabled === true, "配置更新没有成功");
  await waitForAuditAction(client, "config.update");

  const created = await client.fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "把 hello 翻译成中文，只输出一句话。",
      model: "deepseek-v4-flash"
    })
  });
  const taskId = created.body.taskId;
  assert(taskId, "创建任务没有返回 taskId");
  await waitForTask(client, taskId);

  const taskCreateLog = await waitForAuditAction(client, "task.create", taskId);
  assert(taskCreateLog.taskId === taskId, "任务创建审计日志 taskId 不正确");
  const toolCallLog = await waitForAuditAction(client, "agent.tool_call", taskId);
  assert(toolCallLog.resource.startsWith("tool:"), "工具调用审计日志 resource 不正确");

  const verify = (await client.fetchJson("/api/audit/verify")).body;
  assert(verify.ok === true, `审计 hash chain 校验失败：${verify.error ?? "unknown"}`);
  assert(verify.total >= 4, "审计日志数量不足");

  const csv = await client.fetchText("/api/audit/logs?format=csv&limit=20");
  assert(csv.response.headers.get("content-type")?.includes("text/csv"), "审计 CSV 导出 content-type 不正确");
  assert(csv.text.includes("entryHash"), "审计 CSV 缺少 entryHash 列");
  assert(csv.text.includes("agent.tool_call"), "审计 CSV 没有包含工具调用记录");
  const appendOnlyChecked = assertSqliteAppendOnlyTrigger(toolCallLog.id);

  console.log(JSON.stringify({
    ok: true,
    taskId,
    auditEntries: verify.total,
    appendOnlyChecked,
    checked: [
      "auth guard",
      "login audit",
      "config audit",
      "task create audit",
      "tool call audit",
      "hash chain verify",
      "csv export",
      "append-only trigger"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
