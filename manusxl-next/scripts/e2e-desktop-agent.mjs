const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";

const desktopCapabilities = [
  "file_scan",
  "file_classify",
  "file_dedupe",
  "file_rename",
  "file_undo",
  "app_launch",
  "app_quit",
  "clipboard_write",
  "clipboard_read",
  "terminal_command"
];

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

  return { fetchJson, login };
}

async function postJson(pathname, body, token) {
  const response = await fetch(url(pathname), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : {}
  };
}

async function main() {
  console.log(`ManusXL Desktop Agent E2E base URL: ${baseUrl}`);
  const client = createClient(`188${String(Date.now()).slice(-8)}`);
  await client.login();

  const initialStatus = await client.fetchJson("/api/my-computer/status");
  assert(Array.isArray(initialStatus.body.desktopDevices), "My Computer 状态缺少 desktopDevices");

  const pairingBefore = await client.fetchJson("/api/my-computer/desktop/pairing");
  assert(Array.isArray(pairingBefore.body.pairedDevices), "桌面端配对状态缺少设备列表");

  const pairing = await client.fetchJson("/api/my-computer/desktop/pairing", { method: "POST" });
  assert(pairing.body.activeCode?.code, "没有生成桌面端配对码");

  const invalidPairing = await postJson("/api/my-computer/desktop/pairing/verify", {
    code: "000-000",
    deviceName: "Invalid Desktop"
  });
  assert(invalidPairing.response.status === 409, "无效桌面配对码应返回 409");

  const verified = await postJson("/api/my-computer/desktop/pairing/verify", {
    code: pairing.body.activeCode.code,
    deviceName: "E2E ManusXL Desktop",
    bridge: "electron",
    platform: process.platform,
    appVersion: "0.1.0-e2e",
    capabilities: desktopCapabilities,
    metadata: {
      e2e: true
    }
  });
  assert(verified.response.ok, `桌面端配对失败：${JSON.stringify(verified.body)}`);
  assert(verified.body.paired === true, "桌面端没有成功配对");
  assert(verified.body.token, "桌面端配对没有返回设备 token");
  assert(verified.body.device?.status === "online", "刚配对的桌面端应为 online");

  const reusedCode = await postJson("/api/my-computer/desktop/pairing/verify", {
    code: pairing.body.activeCode.code,
    deviceName: "Reused Desktop"
  });
  assert(reusedCode.response.status === 409, "桌面端配对码应一次性使用");

  const heartbeatWithoutToken = await postJson("/api/my-computer/desktop/heartbeat", {
    capabilities: desktopCapabilities
  });
  assert(heartbeatWithoutToken.response.status === 401, "无 token 心跳应返回 401");

  const heartbeat = await postJson(
    "/api/my-computer/desktop/heartbeat",
    {
      capabilities: desktopCapabilities,
      appVersion: "0.1.1-e2e",
      platform: process.platform,
      metadata: {
        pid: process.pid,
        e2e: true
      }
    },
    verified.body.token
  );
  assert(heartbeat.response.ok, `桌面端心跳失败：${JSON.stringify(heartbeat.body)}`);
  assert(heartbeat.body.ok === true, "桌面端心跳没有返回 ok");
  assert(heartbeat.body.device?.appVersion === "0.1.1-e2e", "桌面端心跳没有更新版本");
  assert(Array.isArray(heartbeat.body.allowedRoots), "桌面端心跳没有返回允许目录");
  assert(Array.isArray(heartbeat.body.pendingApprovals), "桌面端心跳没有返回待授权操作");

  const uploadedFromDesktop = await postJson(
    "/api/my-computer/desktop/files/upload",
    {
      name: "desktop-sync-note.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("hello from ManusXL desktop sync", "utf8").toString("base64"),
      sourcePath: "/Users/e2e/Desktop/desktop-sync-note.txt",
      expiresInDays: 7
    },
    verified.body.token
  );
  assert(uploadedFromDesktop.response.ok, `桌面端文件同步失败：${JSON.stringify(uploadedFromDesktop.body)}`);
  assert(uploadedFromDesktop.body.file?.id, "桌面端文件同步没有返回 file id");
  assert(
    uploadedFromDesktop.body.file?.metadata?.source === "desktop-sync",
    "桌面端文件同步没有写入来源 metadata"
  );
  assert(uploadedFromDesktop.body.expiresAt, "桌面端文件同步没有返回 TTL 过期时间");

  const libraryFiles = await client.fetchJson("/api/files");
  assert(
    libraryFiles.body.files?.some((file) => file.id === uploadedFromDesktop.body.file.id),
    "桌面端同步文件没有出现在云端 Library 文件列表"
  );
  assert(
    libraryFiles.body.files?.find((file) => file.id === uploadedFromDesktop.body.file.id)?.expiresAt,
    "Library 文件列表没有返回 TTL 过期时间"
  );

  const uploadRequest = await client.fetchJson("/api/my-computer/desktop/file-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestedPath: "/tmp/manusxl-e2e-request.txt",
      reason: "E2E asks the desktop user to approve a local file upload."
    })
  });
  assert(uploadRequest.body.request?.status === "pending", "Web 没有创建待审批本机上传请求");

  const heartbeatWithRequest = await postJson(
    "/api/my-computer/desktop/heartbeat",
    {
      capabilities: desktopCapabilities
    },
    verified.body.token
  );
  assert(
    heartbeatWithRequest.body.fileRequests?.some((request) => request.id === uploadRequest.body.request.id),
    "桌面端心跳没有收到待审批本机上传请求"
  );

  const deniedUploadRequest = await postJson(
    `/api/my-computer/desktop/file-requests/${encodeURIComponent(uploadRequest.body.request.id)}/decision`,
    {
      decision: "deny"
    },
    verified.body.token
  );
  assert(deniedUploadRequest.response.ok, `拒绝本机上传请求失败：${JSON.stringify(deniedUploadRequest.body)}`);
  assert(deniedUploadRequest.body.request?.status === "denied", "本机上传请求拒绝后状态不正确");

  const approvedUploadRequest = await client.fetchJson("/api/my-computer/desktop/file-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestedPath: "/tmp/manusxl-e2e-approve.txt",
      reason: "E2E approves a local file upload."
    })
  });
  assert(approvedUploadRequest.body.request?.status === "pending", "批准测试的上传请求没有进入 pending");

  const uploadedForRequest = await postJson(
    "/api/my-computer/desktop/files/upload",
    {
      name: "desktop-request-approved.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("approved upload request content", "utf8").toString("base64"),
      sourcePath: "/tmp/manusxl-e2e-approve.txt",
      expiresInDays: 7
    },
    verified.body.token
  );
  assert(uploadedForRequest.response.ok, `批准前文件上传失败：${JSON.stringify(uploadedForRequest.body)}`);

  const approvedDecision = await postJson(
    `/api/my-computer/desktop/file-requests/${encodeURIComponent(approvedUploadRequest.body.request.id)}/decision`,
    {
      decision: "approve",
      uploadedFileId: uploadedForRequest.body.file.id
    },
    verified.body.token
  );
  assert(approvedDecision.response.ok, `批准本机上传请求失败：${JSON.stringify(approvedDecision.body)}`);
  assert(approvedDecision.body.request?.status === "uploaded", "批准上传请求后没有进入 uploaded 状态");
  assert(
    approvedDecision.body.request?.uploadedFileId === uploadedForRequest.body.file.id,
    "批准上传请求没有关联已上传文件"
  );

  const uploadRequests = await client.fetchJson("/api/my-computer/desktop/file-requests");
  assert(
    uploadRequests.body.requests?.some((request) => request.id === deniedUploadRequest.body.request.id),
    "Web 端上传请求列表缺少已拒绝记录"
  );
  assert(
    uploadRequests.body.requests?.some((request) => request.uploadedFileId === uploadedForRequest.body.file.id),
    "Web 端上传请求列表缺少已批准上传记录"
  );

  const desktopTask = await client.fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "E2E My Computer desktop dispatch task",
      fileIds: [uploadedFromDesktop.body.file.id],
      executionTarget: "my-computer"
    })
  });
  assert(desktopTask.body.taskId, "My Computer 任务创建没有返回 taskId");
  assert(desktopTask.body.desktopDispatch?.ok === true, "My Computer 任务没有成功派发到桌面端");
  assert(!desktopTask.body.queue, "My Computer 桌面任务不应进入云端队列");

  const claimedTask = await postJson("/api/my-computer/desktop/tasks/next", {}, verified.body.token);
  assert(claimedTask.response.ok, `桌面端拉取任务失败：${JSON.stringify(claimedTask.body)}`);
  assert(claimedTask.body.assignment?.taskId === desktopTask.body.taskId, "桌面端拉取到的任务不匹配");
  assert(claimedTask.body.assignment?.status === "assigned", "桌面端任务拉取后应为 assigned");
  assert(claimedTask.body.task?.prompt === "E2E My Computer desktop dispatch task", "桌面端任务 prompt 不匹配");
  assert(
    claimedTask.body.task?.uploadedFileIds?.includes(uploadedFromDesktop.body.file.id),
    "桌面端同步文件不能作为任务附件传递给桌面任务"
  );

  const progressEvent = await postJson(
    `/api/my-computer/desktop/tasks/${encodeURIComponent(desktopTask.body.taskId)}/events`,
    {
      type: "tool_result",
      title: "E2E 桌面端进度",
      content: "Desktop progress event from E2E."
    },
    verified.body.token
  );
  assert(progressEvent.response.ok, `桌面端进度事件回写失败：${JSON.stringify(progressEvent.body)}`);
  assert(
    progressEvent.body.task?.events?.some((event) => event.title === "E2E 桌面端进度"),
    "桌面端进度事件没有进入任务时间线"
  );

  const completedTask = await postJson(
    `/api/my-computer/desktop/tasks/${encodeURIComponent(desktopTask.body.taskId)}/complete`,
    {
      ok: true,
      finalAnswer: "E2E desktop completed this My Computer task.",
      artifacts: [
        {
          name: "e2e-desktop-result.md",
          type: "md",
          mimeType: "text/markdown",
          content: "# E2E Desktop Result\n\ncompleted\n"
        }
      ]
    },
    verified.body.token
  );
  assert(completedTask.response.ok, `桌面端完成任务失败：${JSON.stringify(completedTask.body)}`);
  assert(completedTask.body.assignment?.status === "completed", "桌面端任务完成后应为 completed");
  assert(completedTask.body.task?.status === "completed", "Web 任务状态未同步为 completed");
  assert(
    completedTask.body.task?.finalAnswer?.includes("E2E desktop completed"),
    "桌面端完成结果没有写入 finalAnswer"
  );
  assert(
    completedTask.body.task?.events?.some((event) => event.title === "桌面端任务完成"),
    "桌面端完成事件没有进入任务时间线"
  );
  assert(
    completedTask.body.task?.artifacts?.some((artifact) => artifact.name === "e2e-desktop-result.md"),
    "桌面端产物没有进入交付物列表"
  );

  const emptyClaim = await postJson("/api/my-computer/desktop/tasks/next", {}, verified.body.token);
  assert(emptyClaim.response.ok, "桌面端空队列拉取应成功");
  assert(!emptyClaim.body.assignment, "桌面端任务完成后不应重复拉取同一任务");

  const cancellableTask = await client.fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "E2E My Computer desktop cancellable task",
      executionTarget: "my-computer"
    })
  });
  assert(cancellableTask.body.desktopDispatch?.ok === true, "可取消桌面任务没有成功派发");
  const cancelledTask = await client.fetchJson(`/api/tasks/${cancellableTask.body.taskId}/cancel`, {
    method: "POST"
  });
  assert(cancelledTask.body.status === "cancelled", "取消桌面任务后 Web 任务状态应为 cancelled");
  assert(
    cancelledTask.body.desktopAssignments?.some((assignment) => assignment.status === "cancelled"),
    "取消桌面任务后桌面 assignment 应标记为 cancelled"
  );

  const claimAfterCancel = await postJson("/api/my-computer/desktop/tasks/next", {}, verified.body.token);
  assert(claimAfterCancel.response.ok, "取消后的桌面空队列拉取应成功");
  assert(!claimAfterCancel.body.assignment, "已取消的桌面任务不应再被客户端领取");

  const lateProgress = await postJson(
    `/api/my-computer/desktop/tasks/${encodeURIComponent(cancellableTask.body.taskId)}/events`,
    {
      title: "late progress"
    },
    verified.body.token
  );
  assert(lateProgress.response.status === 404, "已取消的桌面任务不应接受新的桌面端进度事件");

  const desktopStoppedTask = await client.fetchJson("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "E2E My Computer desktop stop from client",
      executionTarget: "my-computer"
    })
  });
  assert(desktopStoppedTask.body.desktopDispatch?.ok === true, "桌面端停止测试任务没有成功派发");
  const claimedStoppedTask = await postJson("/api/my-computer/desktop/tasks/next", {}, verified.body.token);
  assert(claimedStoppedTask.body.assignment?.taskId === desktopStoppedTask.body.taskId, "桌面端停止测试任务没有被领取");
  const stoppedFromDesktop = await postJson(
    `/api/my-computer/desktop/tasks/${encodeURIComponent(desktopStoppedTask.body.taskId)}/cancel`,
    {},
    verified.body.token
  );
  assert(stoppedFromDesktop.response.ok, `桌面端停止当前任务失败：${JSON.stringify(stoppedFromDesktop.body)}`);
  assert(stoppedFromDesktop.body.assignment?.status === "cancelled", "桌面端停止后 assignment 应为 cancelled");
  assert(stoppedFromDesktop.body.task?.status === "cancelled", "桌面端停止后 Web 任务应为 cancelled");
  assert(
    stoppedFromDesktop.body.task?.events?.some((event) => event.title === "桌面端已停止任务"),
    "桌面端停止事件没有进入任务时间线"
  );
  const completeStoppedTask = await postJson(
    `/api/my-computer/desktop/tasks/${encodeURIComponent(desktopStoppedTask.body.taskId)}/complete`,
    {
      ok: true,
      finalAnswer: "should not complete"
    },
    verified.body.token
  );
  assert(completeStoppedTask.response.status === 404, "已由桌面端停止的任务不应再接受完成回写");

  const status = await client.fetchJson("/api/my-computer/status");
  assert(status.body.bridge === "electron", "在线桌面端没有切换 My Computer bridge 标识");
  assert(
    status.body.desktopDevices.some((device) => device.name === "E2E ManusXL Desktop" && device.status === "online"),
    "My Computer 状态没有展示在线桌面设备"
  );

  console.log(JSON.stringify({
    ok: true,
    deviceId: verified.body.device.id,
    bridge: status.body.bridge,
    desktopDevices: status.body.desktopDevices.length,
    checks: [
      "pairing status",
      "one-time code",
      "desktop verify",
      "heartbeat auth guard",
      "heartbeat state sync",
      "desktop uploads file into cloud upload library",
      "cloud Library lists desktop synced file with TTL",
      "web requests local file upload approval from desktop",
      "desktop heartbeat receives pending upload requests",
      "desktop can deny requested local upload",
      "desktop can approve and link uploaded local file",
      "web creates My Computer desktop task",
      "desktop claims assigned task",
      "desktop posts progress into task timeline",
      "desktop completes task with final answer and artifacts",
      "web cancellation prevents later desktop claim",
      "desktop stop current task cancels web task",
      "web status shows online desktop"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
