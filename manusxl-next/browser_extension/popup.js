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
        <span>${operation.action}</span>
        <small>${operation.title || operation.url || operation.error || operation.id}</small>
      </div>
      <strong>${operation.status}</strong>
    `;
    container.appendChild(item);
  });
}

async function refreshStatus() {
  const stored = await readStorage();
  const serverUrl = cleanServerUrl(stored.serverUrl);
  $("serverUrl").value = serverUrl;
  if (!stored.pairToken) {
    $("statusText").textContent = "未配对";
    $("pausedText").textContent = "unknown";
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
    renderOperations([]);
    return;
  }
  $("statusText").textContent = `已配对：${data.device?.name || "Chrome Extension"}`;
  $("pausedText").textContent = data.safety?.paused ? "paused" : "active";
  renderOperations(data.safety?.recentOperations || []);
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

$("pairButton").addEventListener("click", () => {
  pairExtension().catch((error) => {
    $("statusText").textContent = error?.message || "配对失败";
  });
});

$("refreshButton").addEventListener("click", () => {
  refreshStatus().catch((error) => {
    $("statusText").textContent = error?.message || "刷新失败";
  });
});

refreshStatus().catch(() => undefined);
