const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function blockedSkillZip() {
  const skillMd = `---
name: browser-admin-blocked
description: 这个 Skill 故意声明未开放工具，用于验证 allowlist 阻断。
triggers: blocked-skill-demo
tools_required: browser_admin
---

# Browser Admin Blocked
`;

  return makeZip([{ name: "browser-admin-blocked/SKILL.md", data: skillMd }]);
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
      parsed = body ? JSON.parse(body) : {};
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

function findSkill(skills, name) {
  return skills.find((skill) => skill.name === name);
}

async function uploadBlockedSkill(client) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([blockedSkillZip()], { type: "application/zip" }),
    "browser-admin-blocked.zip"
  );
  const uploaded = await client.fetchJson("/api/skills/upload", {
    method: "POST",
    body: form
  });
  const blocked = findSkill(uploaded.body.skills ?? [], "browser-admin-blocked");
  assert(blocked, "上传后的 blocked skill 没有出现在列表中");
  assert(blocked.validationStatus === "blocked", "未知工具 skill 没有被标记为 blocked");
  assert(blocked.enabled === false, "blocked skill 不应保持启用");
  assert(blocked.validationWarnings?.[0]?.includes("未授权工具"), "blocked skill 缺少友好错误");
}

async function main() {
  console.log(`ManusXL skills catalog E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const listed = await client.fetchJson("/api/skills");
  const skills = listed.body.skills ?? [];
  const expectedBuiltins = ["pdf", "documents", "presentations", "spreadsheets"];

  for (const name of expectedBuiltins) {
    const skill = findSkill(skills, name);
    assert(skill, `缺少内置 skill：${name}`);
    assert(skill.source === "builtin", `${name} 不是 builtin skill`);
    assert(skill.enabled, `${name} 默认没有启用`);
    assert(skill.validationStatus !== "blocked", `${name} 权限校验被阻断`);
    assert(skill.triggers.length > 0, `${name} 缺少触发词`);
  }

  const presentations = findSkill(skills, "presentations");
  assert(presentations.toolsRequired.includes("artifact_writer"), "presentations 缺少 artifact_writer 权限");

  const disabled = await client.fetchJson("/api/skills", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skillId: "builtin-presentations", enabled: false })
  });
  assert(findSkill(disabled.body.skills ?? [], "presentations")?.enabled === false, "关闭 presentations skill 失败");

  const enabled = await client.fetchJson("/api/skills", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skillId: "builtin-presentations", enabled: true })
  });
  assert(findSkill(enabled.body.skills ?? [], "presentations")?.enabled === true, "重新启用 presentations skill 失败");

  await uploadBlockedSkill(client);

  console.log(JSON.stringify({
    ok: true,
    builtins: expectedBuiltins,
    checked: ["catalog", "toggle", "blocked allowlist"]
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
