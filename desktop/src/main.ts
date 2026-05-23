import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, Tray } from "electron";
import { join } from "node:path";
import { DesktopAgentClient } from "./agent-client";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let client: DesktopAgentClient | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;

async function currentStatus() {
  return client?.status();
}

function createClient() {
  const serverUrl = process.env.MANUSXL_SERVER_URL ?? "http://localhost:3000";
  const configPath = join(app.getPath("userData"), "desktop-device.json");
  client = new DesktopAgentClient(configPath, serverUrl);
  return client;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 360,
    minHeight: 480,
    title: "ManusXL Desktop",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  void mainWindow.loadFile(join(__dirname, "renderer.html"));
}

function createTray() {
  const image = nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip("ManusXL Desktop");
  void refreshTray();
}

async function refreshTray() {
  if (!tray) return;
  const status = await currentStatus();
  const activeTask = status?.currentTask;
  const pendingFileRequests = status?.pendingFileRequests?.length ?? 0;
  const connected = Boolean(status?.lastHeartbeat?.ok);
  tray.setToolTip(activeTask ? `ManusXL Desktop: ${activeTask.prompt}` : "ManusXL Desktop");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: connected ? "Connected" : "Not paired", enabled: false },
    {
      label: activeTask ? `Running: ${activeTask.prompt.slice(0, 36)}` : "No active task",
      enabled: false
    },
    {
      label: pendingFileRequests ? `${pendingFileRequests} file upload request(s)` : "No file upload requests",
      enabled: false
    },
    {
      label: "Stop Current Task",
      enabled: Boolean(activeTask),
      click: () => {
        void client?.cancelCurrentTask()
          .then((nextStatus) => {
            mainWindow?.webContents.send("desktop:status", nextStatus);
            return refreshTray();
          })
          .catch(() => undefined);
      }
    },
    { type: "separator" },
    { label: "Open ManusXL Desktop", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]));
}

async function runHeartbeat(showNotification = false) {
  if (!client) return undefined;
  const result = await client.heartbeat();
  if (showNotification && result?.device && Notification.isSupported()) {
    new Notification({
      title: "ManusXL Desktop connected",
      body: `${result.device.name} is online.`
    }).show();
  }
  const status = await client.status();
  mainWindow?.webContents.send("desktop:status", status);
  await refreshTray();
  return result;
}

function startHeartbeatLoop() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    void runHeartbeat().catch(() => undefined);
  }, 15000);
  void runHeartbeat().catch(() => undefined);
}

app.whenReady().then(() => {
  const desktopClient = createClient();
  createWindow();
  createTray();

  ipcMain.handle("desktop:status", async () => desktopClient.status());
  ipcMain.handle("desktop:update-server-url", async (_event, input: { serverUrl: string }) =>
    desktopClient.updateServerUrl(input.serverUrl)
  );
  ipcMain.handle("desktop:pair", async (_event, input: { code: string; deviceName?: string }) => {
    const result = await desktopClient.pair(input.code, input.deviceName);
    startHeartbeatLoop();
    return result;
  });
  ipcMain.handle("desktop:heartbeat", async () => runHeartbeat(true));
  ipcMain.handle("desktop:cancel-current-task", async () => {
    const status = await desktopClient.cancelCurrentTask();
    await refreshTray();
    return status;
  });
  ipcMain.handle("desktop:upload-file", async () => {
    const selected = await dialog.showOpenDialog(mainWindow ?? undefined, {
      properties: ["openFile"]
    });
    if (selected.canceled || !selected.filePaths[0]) return desktopClient.status();
    const status = await desktopClient.uploadLocalFile(selected.filePaths[0]);
    mainWindow?.webContents.send("desktop:status", status);
    await refreshTray();
    return status;
  });
  ipcMain.handle("desktop:approve-file-request", async (_event, input: { requestId: string }) => {
    const status = await desktopClient.approveFileRequest(input.requestId);
    mainWindow?.webContents.send("desktop:status", status);
    await refreshTray();
    return status;
  });
  ipcMain.handle("desktop:deny-file-request", async (_event, input: { requestId: string }) => {
    const status = await desktopClient.denyFileRequest(input.requestId);
    mainWindow?.webContents.send("desktop:status", status);
    await refreshTray();
    return status;
  });

  startHeartbeatLoop();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
  mainWindow?.hide();
});

app.on("before-quit", () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
});
