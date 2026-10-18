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
- First time: choose **Create team**, pick a team name, your name and a password. Teammates choose **Join team** with the invite code from ⚙ Settings → People and pick their own password. On your other devices, **Sign in** with your name and password.

## Using it

- Drag files, folders, photos, music or video into the column, or paste (⌘V / Ctrl+V), or tap **+**.
- Drag a card out to your desktop/Finder/Explorer to get the file. Folders come out as folders (desktop app) or a .zip (browser).
- Click a card to preview it (images, video, audio, PDF, text). Hover a card to download, pin, move to a stack, or delete.
- ⚙ Settings: split into two columns, create stacks (folders), auto-clear old items, notifications, always-on-top, auto-save incoming files, open at login.
- Show/hide: ⌘⇧Space (Mac) / Ctrl+Shift+Space (Windows/Linux), or the menu-bar/tray icon.

## Making it work anywhere (not just on your Wi-Fi)

Out of the box the server runs on your machine, so other devices need to be on the same network.
To reach it from anywhere, either:

1. **Tailscale** (easiest, free): install on every device and use the Mac's Tailscale address, or
2. **Host the server** on Railway, Fly.io, Render or a VPS. It's one Node process; set `DATA_DIR` to a persistent volume
   and put it behind HTTPS. Then point every device at that URL.

Env vars: `PORT` (default 4747), `DATA_DIR` (default `server/data`), `PUBLIC_URL` (the address browsers use to reach the
server, e.g. `https://column.example.com`; default `http://localhost:4747`), `COLUMN_SECRET` (encrypts calendar sign-ins at
rest; if unset, a random key is created at `DATA_DIR/secret.key`. Back it up with the data, or everyone reconnects).

## Calendars (Google / Outlook)

Everyone connects their own calendars in ⚙ Settings → Calendars. Events show in their Day (only they see them), and blocks
they make in Column go to the calendar they pick. Edits and deletes follow both ways. The server needs an app registration
with each provider. The sign-in comes back to `PUBLIC_URL/oauth/<provider>/callback`, so register exactly that address.
Until the server is hosted, use `http://localhost:4747` and connect from the machine running the server. Google and Microsoft
only allow `localhost` or `https://` addresses, not Wi-Fi IPs.

**Google Calendar:** in [Google Cloud Console](https://console.cloud.google.com/):
1. Create a project, then *APIs & Services → Library → Google Calendar API → Enable*.
2. *OAuth consent screen*: External, add your email as a test user, and add the scopes
   `.../auth/calendar.events` and `.../auth/calendar.calendarlist.readonly`.
3. *Credentials → Create credentials → OAuth client ID → Web application*. Add the redirect URI
   `http://localhost:4747/oauth/google/callback` (and your hosted `https://…/oauth/google/callback` later).
4. Start the server with `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… npm run server`.

While the app is in *Testing*, only the test users you list (up to 100) can connect, which is fine for a beta. Public launch needs
Google's verification for the calendar scopes.

**Outlook / Microsoft 365:** in [Azure portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade):
1. *New registration*: "Accounts in any organizational directory and personal Microsoft accounts", redirect URI (Web)
   `http://localhost:4747/oauth/microsoft/callback`.
2. *Certificates & secrets → New client secret*; copy the value.
3. *API permissions → Microsoft Graph → Delegated*: `Calendars.ReadWrite`, `User.Read`, `offline_access`.
4. Start the server with `MS_CLIENT_ID=… MS_CLIENT_SECRET=…` (optionally `MS_TENANT` to allow only one organization).

Sync pulls 7 days back to 60 days ahead, every 3 minutes (or *Sync now*). Repeating Column entries and multi-day events
stay one-way for now.

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
