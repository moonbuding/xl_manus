# ManusXL Desktop

Electron-based My Computer desktop bridge.

## Current MVP

- Pair with the web app using a 5-minute code generated in Settings / My Computer.
- Persist the desktop device token in Electron `userData`.
- Send a heartbeat to `/api/my-computer/desktop/heartbeat` every 15 seconds.
- Report platform, app version and desktop capabilities to the web app.
- Poll `/api/my-computer/desktop/tasks/next`, claim My Computer tasks, and complete them back into the web task timeline.
- Execute the first read-only local tools on the paired desktop: directory scan, classification preview and duplicate-content preview under Web-configured allowed roots.
- Execute classification moves only when the task prompt explicitly includes an execution phrase such as `确认执行` / `执行分类` / `execute`, and write `.manusxl-desktop-undo.json` so a later `撤销` / `undo` task can restore files.
- Route desktop system tasks to a constrained native tool layer: app launch/quit, clipboard read/write and terminal commands all require explicit confirmation, and terminal execution is non-shell with a small allowlist.
- Select a local file from the desktop window and upload it to the web app upload library with a 7-day TTL metadata marker, so the returned file id can be attached to later tasks.

## Local Run

```bash
cd desktop
npm install
MANUSXL_SERVER_URL=http://localhost:3000 npm run dev
```

In the web app:

1. Open `Settings`.
2. Find `My Computer`.
3. Click `桌面端配对`.
4. Paste the pairing code into the desktop window.

The next slices are confirmed move/rename operations inside the desktop client, tray progress, packaged macOS/Windows installers and auto-update.
