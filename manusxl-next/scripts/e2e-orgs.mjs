const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";

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

  async function fetchJson(pathname, init = {}, allowError = false) {
    const headers = new Headers(init.headers);
    const cookies = cookieHeader();
    if (cookies) headers.set("Cookie", cookies);
    const response = await fetch(url(pathname), { ...init, headers });
    rememberCookies(response.headers);
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!allowError) assert(response.ok, `${pathname} 请求失败：${response.status} ${text}`);
    return { response, body };
  }

  async function login() {
    const requested = await fetchJson("/api/auth/phone/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    await fetchJson("/api/auth/phone/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code: requested.body.verificationCode })
    });
  }

  return { fetchJson, login, phone };
}

async function main() {
  console.log(`ManusXL org E2E base URL: ${baseUrl}`);
  const owner = createClient(`188${String(Date.now()).slice(-8)}`);
  const viewer = createClient(`188${String(Date.now() + 37).slice(-8)}`);
  await owner.login();
  await viewer.login();

  const created = await owner.fetchJson("/api/orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Org E2E ${Date.now()}`, taskQuota: 2 })
  });
  const orgId = created.body.organization.id;
  assert(orgId, "创建组织没有返回 orgId");
  assert(created.body.organization.role === "owner", "创建者不是 owner");

  const secondOrg = await owner.fetchJson("/api/orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Second Org E2E ${Date.now()}`, taskQuota: 1 })
  });
  assert(secondOrg.body.organization.id, "第二个组织创建失败");
  const ownerOrgs = await owner.fetchJson("/api/orgs");
  assert(ownerOrgs.body.organizations.length >= 2, "用户没有同时加入多个组织");

  const invited = await owner.fetchJson(`/api/orgs/${orgId}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: viewer.phone, role: "viewer" })
  });
  assert(invited.body.invitation?.token, "邀请没有返回 token");

  const accepted = await viewer.fetchJson("/api/orgs/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: invited.body.invitation.token })
  });
  assert(accepted.body.invitation?.status === "accepted", "邀请未接受成功");

  const members = await owner.fetchJson(`/api/orgs/${orgId}/members`);
  assert(
    members.body.members.some((member) => member.user?.phone === viewer.phone && member.role === "viewer"),
    "成员列表缺少 viewer"
  );

  const viewerCreate = await viewer.fetchJson(
    "/api/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, prompt: "viewer should not create org task" })
    },
    true
  );
  assert(viewerCreate.response.status === 403, "Viewer 新建组织任务应被拒绝");

  const task = await owner.fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orgId,
      visibility: "org",
      prompt: `org-share-e2e-${Date.now()} 生成一个短报告`
    })
  });
  assert(task.body.taskId, "Owner 创建组织任务失败");

  const viewerTasks = await viewer.fetchJson(`/api/orgs/${orgId}/tasks`);
  assert(
    viewerTasks.body.tasks.some((item) => item.id === task.body.taskId),
    "Viewer 看不到组织共享任务"
  );
  const sharedDetail = await viewer.fetchJson(`/api/tasks/${task.body.taskId}`);
  assert(sharedDetail.body.id === task.body.taskId, "Viewer 无法读取共享任务详情");

  const quotaOrg = await owner.fetchJson("/api/orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Quota Org E2E ${Date.now()}`, taskQuota: 0 })
  });
  const quotaBlocked = await owner.fetchJson(
    "/api/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: quotaOrg.body.organization.id, prompt: "quota should block this task" })
    },
    true
  );
  assert(quotaBlocked.response.status === 409, "组织配额满后新任务应被拒绝");

  console.log(
    JSON.stringify(
      {
        ok: true,
        orgId,
        sharedTaskId: task.body.taskId,
        viewerRole: "viewer",
        ownerOrgCount: ownerOrgs.body.organizations.length,
        quotaBlocked: quotaBlocked.body.error
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
