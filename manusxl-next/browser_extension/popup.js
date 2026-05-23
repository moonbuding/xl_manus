/* global chrome */

const storageKeys = ["serverUrl", "pairToken", "deviceName"];

function $(id) {
  return document.getElementById(id);
}

async function readStorage() {
  return chrome.storage.local.get(storageKeys);
}

async function writeStorage(values) {
  return chrome.storage.local.set(values);
}

function cleanServerUrl(value) {
  return (value || "http://localhost:3001").replace(/\/+$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderApprovals(approvals) {
  const container = $("approvals");
  if (!approvals?.length) {
    container.textContent = "暂无待确认操作";
    return;
  }
  container.textContent = "";
  approvals.slice(0, 4).forEach((approval) => {
    const item = document.createElement("div");
    item.className = "approval";
    item.innerHTML = `
      <div>
        <span>${escapeHtml(approval.description || approval.action)}</span>
        <small>${escapeHtml(approval.title || approval.url || approval.id)}</small>
      </div>
      <div class="approval-actions">
        <button class="approve" data-approval-id="${escapeHtml(approval.id)}" data-approved="true" type="button">允许</button>
        <button class="reject" data-approval-id="${escapeHtml(approval.id)}" data-approved="false" type="button">拒绝</button>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderOperations(operations) {
  const container = $("operations");
  if (!operations?.length) {
    container.textContent = "暂无操作";
    return;
  }
  container.textContent = "";
  operations.slice(0, 6).forEach((operation) => {
    const item = document.createElement("div");
    item.className = "operation";
    item.innerHTML = `
      <div>
        <span>${escapeHtml(operation.action)}</span>
        <small>${escapeHtml(operation.title || operation.url || operation.error || operation.id)}</small>
      </div>
      <strong>${escapeHtml(operation.status)}</strong>
    `;
    container.appendChild(item);
  });
}

function renderSafety(safety) {
  const paused = Boolean(safety?.paused);
  $("pausedText").textContent = paused ? "paused" : "active";
  $("togglePauseButton").textContent = paused ? "恢复操作" : "暂停操作";
  $("togglePauseButton").dataset.paused = String(paused);
  renderApprovals(safety?.pendingApprovals || []);
  renderOperations(safety?.recentOperations || []);
}

async function refreshStatus() {
  const stored = await readStorage();
  const serverUrl = cleanServerUrl(stored.serverUrl);
  $("serverUrl").value = serverUrl;
  if (!stored.pairToken) {
    $("statusText").textContent = "未配对";
    $("pausedText").textContent = "unknown";
    $("togglePauseButton").textContent = "暂停操作";
    $("togglePauseButton").dataset.paused = "false";
    renderApprovals([]);
    renderOperations([]);
    return;
  }

  const response = await fetch(`${serverUrl}/api/local-browser/extension/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: stored.pairToken })
  });
  const data = await response.json();
  if (!data.paired) {
    $("statusText").textContent = data.error || "配对失效";
    $("pausedText").textContent = "unknown";
    $("togglePauseButton").textContent = "暂停操作";
    $("togglePauseButton").dataset.paused = "false";
    renderApprovals([]);
    renderOperations([]);
    return;
  }
  $("statusText").textContent = `已配对：${data.device?.name || "Chrome Extension"}`;
  renderSafety(data.safety);
}

async function pairExtension() {
  const serverUrl = cleanServerUrl($("serverUrl").value);
  const code = $("pairCode").value.trim();
  await writeStorage({ serverUrl });
  $("statusText").textContent = "配对中...";
  const response = await fetch(`${serverUrl}/api/local-browser/pairing/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      deviceName: "Chrome Extension",
      extensionId: chrome.runtime.id
    })
  });
  const data = await response.json();
  if (!data.paired || !data.token) {
    $("statusText").textContent = data.error || "配对失败";
    return;
  }
  await writeStorage({ pairToken: data.token, deviceName: data.device?.name || "Chrome Extension" });
  $("pairCode").value = "";
  await refreshStatus();
}

async function togglePause() {
  const stored = await readStorage();
  const serverUrl = cleanServerUrl(stored.serverUrl);
  if (!stored.pairToken) {
    $("statusText").textContent = "请先配对扩展";
    return;
  }
  const nextPaused = $("togglePauseButton").dataset.paused !== "true";
  const response = await fetch(`${serverUrl}/api/local-browser/extension/safety`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: stored.pairToken,
      paused: nextPaused
    })
  });
  const data = await response.json();
  if (!data.paired) {
    $("statusText").textContent = data.error || "操作失败";
    return;
  }
  $("statusText").textContent = `已配对：${data.device?.name || "Chrome Extension"}`;
  renderSafety(data.safety);
}

async function decideApproval(approvalId, approved) {
  const stored = await readStorage();
  const serverUrl = cleanServerUrl(stored.serverUrl);
  if (!stored.pairToken) {
    $("statusText").textContent = "请先配对扩展";
    return;
  }
  const response = await fetch(`${serverUrl}/api/local-browser/extension/approval`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: stored.pairToken,
      approvalId,
      approved
    })
  });
  const data = await response.json();
  if (!response.ok || !data.paired) {
    $("statusText").textContent = data.error || "确认失败";
    return;
  }
  $("statusText").textContent = approved ? "已允许本次操作" : "已拒绝本次操作";
  renderSafety(data.safety);
}

$("pairButton").addEventListener("click", () => {
  pairExtension().catch((error) => {
    $("statusText").textContent = error?.message || "配对失败";
  });
});

$("togglePauseButton").addEventListener("click", () => {
  togglePause().catch((error) => {
    $("statusText").textContent = error?.message || "操作失败";
  });
});

$("refreshButton").addEventListener("click", () => {
  refreshStatus().catch((error) => {
    $("statusText").textContent = error?.message || "刷新失败";
  });
});

$("approvals").addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const approvalId = target.dataset.approvalId;
  if (!approvalId) return;
  decideApproval(approvalId, target.dataset.approved === "true").catch((error) => {
    $("statusText").textContent = error?.message || "确认失败";
  });
});

refreshStatus().catch(() => undefined);
