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
    const body = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }
    if (!allowError) {
      assert(response.ok, `${pathname} 请求失败：${response.status} ${body}`);
    }
    return { response, body: parsed };
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
    return verified.body.user;
  }

  return { fetchJson, login };
}

async function listTemplates(client, query = "") {
  const result = await client.fetchJson(`/api/templates${query}`);
  return result.body.templates ?? [];
}

async function main() {
  console.log(`ManusXL templates E2E base URL: ${baseUrl}`);
  const userA = createClient("18800000001");
  const userB = createClient("18800000002");
  await userA.login();
  await userB.login();

  const publicTemplates = await listTemplates(userA, "?tag=public");
  assert(publicTemplates.length >= 3, "公共模板数量不足");
  assert(publicTemplates.every((template) => template.isPublic), "tag=public 返回了非公共模板");

  const created = await userA.fetchJson("/api/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E 模板隔离",
      description: "验证模板标签过滤和用户隔离",
      promptTemplate: "分析 {industry} 行业，并输出 {deliverable}",
      tags: ["e2e-template", "research"]
    })
  });
  const privateTemplate = created.body;
  assert(privateTemplate.id, "创建模板没有返回 ID");
  assert(!privateTemplate.isPublic, "用户创建的模板不应是公共模板");

  const userATagged = await listTemplates(userA, "?tag=e2e-template");
  assert(userATagged.some((template) => template.id === privateTemplate.id), "用户 A 标签过滤找不到自己的模板");

  const userBTagged = await listTemplates(userB, "?tag=e2e-template");
  assert(
    !userBTagged.some((template) => template.id === privateTemplate.id),
    "用户 B 看到了用户 A 的私有模板"
  );

  const deletePublic = await userA.fetchJson(
    `/api/templates/${publicTemplates[0].id}`,
    { method: "DELETE" },
    true
  );
  assert(deletePublic.response.status === 404, "普通用户不应删除公共模板");

  const deleted = await userA.fetchJson(`/api/templates/${privateTemplate.id}`, { method: "DELETE" });
  assert(deleted.body.ok, "删除私有模板失败");

  console.log("模板系统 E2E 通过：公共模板、标签过滤、用户隔离和删除保护均已检查。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
