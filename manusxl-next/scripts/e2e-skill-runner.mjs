const base = process.env.MANUSXL_E2E_BASE_URL || "http://localhost:3001";

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

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  return { response, body };
}

function cookieHeader(headers) {
  const raw = headers.get("set-cookie") || "";
  return raw
    .split(/,\s*(?=[^;]+=)/)
    .map((part) => part.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function login() {
  const phone = `188${String(Date.now()).slice(-8)}`;
  const sent = await request("/api/auth/phone/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
  if (!sent.response.ok) throw new Error(`request code failed: ${JSON.stringify(sent.body)}`);

  const verified = await request("/api/auth/phone/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code: sent.body.verificationCode })
  });
  if (!verified.response.ok) throw new Error(`verify failed: ${JSON.stringify(verified.body)}`);
  return cookieHeader(verified.response.headers);
}

function demoSkillZip() {
  const skillMd = `---
name: route-skill-runner-demo
description: 用沙盒脚本把路线类任务整理成 Markdown 结果。
triggers: skill-runner-demo, 自定义路线
tools_required: skill_runner
---

# Route Skill Runner Demo

This skill verifies that ManusXL can execute uploaded Skill scripts in the task sandbox.
`;
  const mainPy = `import json
import pathlib
import sys

input_path = pathlib.Path(sys.argv[1])
output_path = pathlib.Path(sys.argv[2])
payload = json.loads(input_path.read_text(encoding="utf-8"))
prompt = payload.get("prompt", "")
result = {
    "observation": "自定义 Skill 脚本已在沙盒中执行，并读取到任务输入。",
    "markdown": "# Skill Runner Result\\n\\n- Prompt: " + prompt[:120] + "\\n- Skill: " + payload.get("skill", {}).get("name", "unknown")
}
output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print("skill-runner-demo ok")
`;

  return makeZip([
    { name: "route-skill-runner-demo/SKILL.md", data: skillMd },
    { name: "route-skill-runner-demo/main.py", data: mainPy }
  ]);
}

async function uploadSkill(cookies) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([demoSkillZip()], { type: "application/zip" }),
    "route-skill-runner-demo.zip"
  );
  const uploaded = await request("/api/skills/upload", {
    method: "POST",
    headers: { Cookie: cookies },
    body: form
  });
  if (!uploaded.response.ok) throw new Error(`upload skill failed: ${JSON.stringify(uploaded.body)}`);
  const skill = uploaded.body.skills?.find((item) => item.name === "route-skill-runner-demo");
  if (!skill?.enabled) throw new Error("uploaded skill is missing or disabled");
}

async function waitForTask(taskId, cookies) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const task = await request(`/api/tasks/${taskId}`, {
      headers: { Cookie: cookies }
    });
    if (!task.response.ok) throw new Error(`task detail failed: ${JSON.stringify(task.body)}`);
    if (["completed", "failed", "cancelled", "timeout"].includes(task.body.status)) return task.body;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`task ${taskId} did not finish in time`);
}

async function main() {
  const cookies = await login();
  await uploadSkill(cookies);
  const created = await request("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify({
      prompt: "skill-runner-demo 请执行自定义路线 Skill，并输出脚本执行结果"
    })
  });
  if (!created.response.ok) throw new Error(`create task failed: ${JSON.stringify(created.body)}`);

  const task = await waitForTask(created.body.taskId, cookies);
  const text = JSON.stringify(task);
  const hasSkillRunner = task.events.some(
    (event) => event.type === "tool_call" && event.title === "skill_runner"
  );
  const hasSkillArtifact = task.artifacts.some((artifact) =>
    artifact.name.includes("skill-output")
  );

  if (task.status !== "completed" || !hasSkillRunner || !hasSkillArtifact || !text.includes("自定义 Skill 脚本已在沙盒中执行")) {
    throw new Error(`skill runner e2e failed: ${JSON.stringify({
      status: task.status,
      hasSkillRunner,
      hasSkillArtifact,
      artifactNames: task.artifacts.map((artifact) => artifact.name)
    }, null, 2)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    taskId: task.id,
    artifacts: task.artifacts.map((artifact) => artifact.name).filter((name) => name.includes("skill"))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
