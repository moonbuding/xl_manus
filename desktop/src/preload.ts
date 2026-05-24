import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("manusxlDesktop", {
  status: () => ipcRenderer.invoke("desktop:status"),
  pair: (code: string, deviceName?: string) => ipcRenderer.invoke("desktop:pair", { code, deviceName }),
  unpair: () => ipcRenderer.invoke("desktop:unpair"),
  heartbeat: () => ipcRenderer.invoke("desktop:heartbeat"),
  updateServerUrl: (serverUrl: string) => ipcRenderer.invoke("desktop:update-server-url", { serverUrl }),
  cancelCurrentTask: () => ipcRenderer.invoke("desktop:cancel-current-task"),
  uploadFile: () => ipcRenderer.invoke("desktop:upload-file"),
  confirmUploadFile: () => ipcRenderer.invoke("desktop:confirm-upload-file"),
  cancelUploadFile: () => ipcRenderer.invoke("desktop:cancel-upload-file"),
  approveFileRequest: (requestId: string) => ipcRenderer.invoke("desktop:approve-file-request", { requestId }),
  denyFileRequest: (requestId: string) => ipcRenderer.invoke("desktop:deny-file-request", { requestId }),
  onStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on("desktop:status", handler);
    return () => ipcRenderer.removeListener("desktop:status", handler);
  }
});
