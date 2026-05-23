const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";
const timeoutMs = Number(process.env.MANUSXL_E2E_TIMEOUT_MS ?? 90000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
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

  async function login() {
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
    return verified.user;
  }

  return { fetchJson, login };
}

async function waitForTask(client, taskId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await client.fetchJson(`/api/tasks/${taskId}`);
    if (["completed", "failed", "cancelled", "timeout"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`任务 ${taskId} 在 ${timeoutMs}ms 内没有完成`);
}

async function main() {
  console.log(`ManusXL scheduled integrations E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  const user = await client.login();

  const marker = `scheduled-e2e-${Date.now()}`;
  const created = await client.fetchJson("/api/scheduled-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: marker,
      prompt: `定时任务验收：输出 ${marker}`,
      kind: "interval",
      intervalMinutes: 0.02
    })
  });
  assert(created.task?.id, "创建定时任务没有返回 id");

  try {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await client.fetchJson("/api/scheduled-tasks/tick", { method: "POST" });
    const afterTick = await client.fetchJson("/api/scheduled-tasks");
    const schedule = afterTick.tasks.find((item) => item.id === created.task.id);
    assert(schedule?.lastTaskId, "计划任务到期后没有创建任务");
    const scheduledTask = await waitForTask(client, schedule.lastTaskId);
    assert(scheduledTask.prompt.includes(marker), "计划任务创建的任务 prompt 不正确");

    const mail = await fetch(url("/api/integrations/mail/inbound"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: `${user.id}@mail.xl-manus.local`,
        from: user.email,
        subject: `Mail Manus ${marker}`,
        text: "请整理这封邮件并输出行动项。"
      })
    });
    const mailBody = await mail.json();
    assert(mail.ok, `Mail inbound 失败：${JSON.stringify(mailBody)}`);
    assert(mailBody.taskId, "Mail inbound 没有创建任务");

    const slack = await fetch(url("/api/integrations/slack/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerId: user.id,
        event: {
          type: "app_mention",
          text: `<@xl-manus> Slack Manus ${marker}，请生成简短汇总。`,
          channel: "C-e2e",
          user: "U-e2e"
        }
      })
    });
    const slackBody = await slack.json();
    assert(slack.ok, `Slack event 失败：${JSON.stringify(slackBody)}`);
    assert(slackBody.taskId, "Slack event 没有创建任务");
    await waitForTask(client, mailBody.taskId);
    await waitForTask(client, slackBody.taskId);

    const logs = await client.fetchJson("/api/scheduled-tasks");
    assert(logs.logs.some((log) => log.triggerType === "schedule" && log.taskId === schedule.lastTaskId), "缺少 schedule 日志");
    assert(logs.logs.some((log) => log.triggerType === "mail" && log.taskId === mailBody.taskId), "缺少 mail 日志");
    assert(logs.logs.some((log) => log.triggerType === "slack" && log.taskId === slackBody.taskId), "缺少 slack 日志");

    console.log(JSON.stringify({
      ok: true,
      scheduleId: schedule.id,
      scheduledTaskId: schedule.lastTaskId,
      mailTaskId: mailBody.taskId,
      slackTaskId: slackBody.taskId,
      logCount: logs.logs.length
    }, null, 2));
  } finally {
    await client.fetchJson(`/api/scheduled-tasks/${created.task.id}`, { method: "DELETE" }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
