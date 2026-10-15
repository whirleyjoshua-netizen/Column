# Column

Drop anything into a column. It shows up on every device signed in to the same account or team.

```
column/
  server/   Node sync server: accounts, file storage, live updates (WebSocket)
  client/   The column UI. Served by the server, used by desktop, browsers and phones
  desktop/  Electron app: docked column, tray/menu-bar icon, hotkey, drag-out to desktop
```

## Run it

```bash
cd ~/column
npm run setup        # once: installs server + desktop deps
npm run server       # starts the server on :4747 and prints the address for other devices
npm run desktop      # in a second terminal: opens the column (connect to http://localhost:4747)
```

- **Other computers:** run `npm run desktop` there and connect to the "Other devices" address the server prints, or just open that address in a browser.
- **Phones:** open that address in Safari/Chrome → Share → *Add to Home Screen*.
- First time: choose **Create new**, pick an account/team name and passphrase. Every other device or teammate uses **Sign in** with the same name and passphrase.

## Using it

- Drag files, folders, photos, music or video into the column, or paste (⌘V / Ctrl+V), or tap **+**.
- Drag a card out to your desktop/Finder/Explorer to get the file. Folders come out as folders (desktop app) or a .zip (browser).
- Click a card to preview it (images, video, audio, PDF, text). Hover a card to download, pin, move to a stack, or delete.
- ⚙ Settings: split into two columns (files | chat), create stacks (folders), auto-clear old items, notifications, always-on-top, auto-save incoming files, open at login.
- Show/hide: ⌘⇧Space (Mac) / Ctrl+Shift+Space (Windows/Linux), or the menu-bar/tray icon.

## Making it work anywhere (not just on your Wi-Fi)

Out of the box the server runs on your machine, so other devices need to be on the same network.
To reach it from anywhere, either:

1. **Tailscale** (easiest, free): install on every device and use the Mac's Tailscale address, or
2. **Host the server** on Railway, Fly.io, Render or a VPS. It's one Node process; set `DATA_DIR` to a persistent volume
   and put it behind HTTPS. Then point every device at that URL.

Env vars: `PORT` (default 4747), `DATA_DIR` (default `server/data`).

## Build installers

```bash
cd desktop
npm run dist:mac     # .dmg   (unsigned. Right-click → Open the first time)
npm run dist:win     # .exe installer
npm run dist:linux   # AppImage
```

## Known limits (v0.1)

- Storage is a local folder + JSON file: fine for you or a small team. Swap to S3/R2 + Postgres when it grows.
- Folder .zip downloads are capped at 4 GB (single files have no limit). The desktop app drags folders out directly with no cap.
- Uploads restart from zero if the connection drops (resumable uploads are a good next step).
- No end-to-end encryption yet. Use HTTPS when hosting.
