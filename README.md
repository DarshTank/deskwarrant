# DeskWarrant

**Natural-language PC agent with remote control.**

A Windows PC runs a small always-on host agent. You reach that PC from a web app
on any other device — laptop, desktop, or phone — and can:

- **Ask** questions in plain language ("is the download finished?", "what's using
  my CPU?") and get answers derived from real system data.
- **Act** through natural language ("close Chrome"), executed from a fixed, typed
  action catalog.
- **Watch** — the PC pushes notifications when predefined conditions occur.
- **Control** — a live screen view with mouse and keyboard.

Ask, Act, and Watch need no video session at all. During Control, the chat panel
stays live, so you can delegate a task and watch it happen.

---

## Privacy property

**Your screen is never sent to any AI model.** The assistant only ever receives
text — process names, PIDs, window titles, file listings, numeric statistics.
No image is ever sent to Groq or any third party, and there is no vision model
anywhere in this system.

**Live view streams over an encrypted tunnel and is never stored.** Frames go
from your PC to Cloudflare's edge and on to your browser, encrypted in flight.
They are not written to the database and not retained anywhere.

> Earlier versions of this project used peer-to-peer WebRTC and claimed frames
> touched no third party. That is no longer accurate — frames now transit
> Cloudflare's edge. The claim above is what is true today.

---

## Architecture

```
┌────────────────┐         ┌──────────────────────────┐         ┌──────────────┐
│  Browser       │         │  Console (Vercel)        │         │  Neon PG     │
│  (any device)  │◄───────►│  - Next.js UI            │◄───────►│              │
│                │  HTTPS  │  - API routes            │ Prisma  └──────────────┘
│                │         │  - Assistant (Groq loop) │
└───────┬────────┘         └────────────┬─────────────┘
        │                               │
        │                               │ HTTP polling (2s)
        │  WebSocket over               │ agent → console
        │  Cloudflare Tunnel (TLS)      │
        │                               ▼
        │   ┌────────────────┐  ┌──────────────────────┐
        └──►│ Cloudflare edge│─►│  Host Agent (Windows)│
            └────────────────┘  │  - tool executor     │
             outbound-only,     │  - watch evaluator   │
             on demand          │  - capture + input   │
                                │  - 127.0.0.1 server  │
                                └──────────────────────┘
```

**Why polling, not WebSockets.** Vercel serverless functions terminate after
returning a response and cannot hold long-lived connections. The agent polls
`GET /api/agent/poll` every 2 seconds, and that poll doubles as the heartbeat
driving online/offline status. A 2-second worst-case dispatch latency is
imperceptible for "is my render done?", and it removes an entire class of
infrastructure problems.

**Why a tunnel, not WebRTC.** The agent opens an **outbound** connection to
Cloudflare's edge and gets back a public HTTPS hostname; the browser connects to
that hostname over WebSocket. There is no NAT traversal, no ICE, no relay quota,
and no degraded fallback mode — it runs at full frame rate on every network,
including a phone on mobile data with the PC behind home NAT. That case is
exactly where peer-to-peer used to fail without a paid TURN relay.

**The tunnel runs on demand, not permanently.** It starts when you open live
view and stops within ~20 seconds of you closing it, so the PC is reachable from
the internet only while you are actually watching. Starting it costs 3–6
seconds, which is the price of not being publicly addressable around the clock.

**Frames never touch the console.** They go PC → Cloudflare edge → browser. The
console handles authentication and session lifecycle only, so live view costs
nothing in Vercel bandwidth.

---

## Repository layout

```
deskwarrent/
├── console/                     # Next.js 16 app (UI + API routes)
│   ├── app/
│   │   ├── (auth)/signin/
│   │   ├── (dashboard)/devices/[id]/
│   │   └── api/                 # agent, devices, jobs, view, push
│   ├── components/              # Chat, LiveView, WatchRules, EventFeed
│   ├── lib/
│   │   ├── assistant/           # loop, system prompt, tool catalog (Zod)
│   │   ├── watch/templates.ts
│   │   ├── auth.ts  db.ts  view.ts  safety helpers
│   └── prisma/schema.prisma
│
└── agent/                       # Python 3.11+ host agent (Windows only)
    ├── main.py                  # supervisor loop
    ├── config.py  credentials.py  transport.py  pairing.py  safety.py
    ├── tools/                   # registry + processes, windows, files, system, actions
    ├── watch/rules.py           # local rule evaluation
    ├── server/                  # app (127.0.0.1 WS), tunnel, capture, input
    ├── deskwarrant.spec         # PyInstaller
    └── install.ps1              # Task Scheduler registration
```

---

## Setup

You need five things, all free-tier: a **Neon** Postgres database, a **Google
OAuth** client, a **Groq** API key, a **VAPID** key pair, and — for live view
only — a **domain on Cloudflare's free plan**. No card is required for any of
them.

### 1. Console environment

```bash
cd console
cp .env.example .env      # then fill it in
```

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon → **pooled** endpoint. Hostname **must** contain `-pooler`. |
| `DIRECT_URL` | Neon → direct endpoint. Used by `prisma migrate` only. |
| `AUTH_SECRET` | `npx auth secret` |
| `AUTH_URL` | `http://localhost:3000`, or your Vercel URL in production |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google Cloud Console → Credentials → OAuth 2.0 Client (Web). Authorized redirect URI must be `<AUTH_URL>/api/auth/callback/google` |
| `GROQ_API_KEY` | console.groq.com/keys |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Same value as `VAPID_PUBLIC_KEY` |

> **The two database URLs are not interchangeable.** Prisma on Vercel needs the
> pooled endpoint at runtime and the direct endpoint for migrations. Getting this
> wrong causes intermittent connection failures under serverless load — a failure
> mode that looks like flakiness rather than misconfiguration.

Then:

```bash
npm install
npx prisma migrate dev --name init    # creates the schema in Neon
npm run dev
```

### 2. Host agent

On the Windows PC:

```powershell
cd agent
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

On first run it asks for the console URL and a pairing code. Generate the code in
the console (**Devices → Generate pairing code**), type it in, and the PC appears
as ONLINE.

The device token is stored in **Windows Credential Manager** under the service
name `DeskWarrant` — never in `config.json`, never in the repo.

Agent config lives at `%LOCALAPPDATA%\DeskWarrant\config.json`:

```jsonc
{
  "consoleUrl": "https://<app>.vercel.app",
  "pollIntervalMs": 2000,
  "allowedRoots": ["%USERPROFILE%\\Downloads", "%USERPROFILE%\\Documents", "%USERPROFILE%\\Desktop"],
  "view": {
    "tunnelName": "deskwarrant-darsh-pc",
    "hostname": "pc-7f2a.yourdomain.com",
    "localPort": 47821,
    "tileSize": 128,
    "targetFps": 10,
    "webpQuality": 70
  }
}
```

To grant access to more folders, edit `allowedRoots` **on the machine itself**.
Roots can never be changed remotely, and the assistant can never change them.

Ask, Act, and Watch work with `view` left empty. It is needed only for live view.

### 3. Cloudflare Tunnel, for live view (once per PC)

This is a one-time manual step and is **deliberately not automated**: doing it
from code would mean storing a Cloudflare API token on the PC, which is a worse
trade than five minutes of setup on a handful of personal machines.

1. Add a domain you own to Cloudflare on the **free** plan and point its
   nameservers at Cloudflare. No card required.
2. Install `cloudflared` and log in — this opens a browser to authorise the
   domain:
   ```powershell
   winget install --id Cloudflare.cloudflared
   cloudflared tunnel login
   ```
3. Create a named tunnel for this PC:
   ```powershell
   cloudflared tunnel create deskwarrant-darsh-pc
   ```
4. Route a hostname to it:
   ```powershell
   cloudflared tunnel route dns deskwarrant-darsh-pc pc-7f2a.yourdomain.com
   ```
5. Point the tunnel at the agent's local port by adding this to
   `%USERPROFILE%\.cloudflared\config.yml`:
   ```yaml
   tunnel: deskwarrant-darsh-pc
   credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
   ingress:
     - hostname: pc-7f2a.yourdomain.com
       service: http://127.0.0.1:47821
     - service: http_status:404
   ```
6. Put `tunnelName` and `hostname` into the agent's `config.json` as shown
   above. The agent reports them to the console on its next poll.

Verify before going further — run a dummy server on the port, start the tunnel,
and load the hostname in a browser:

```powershell
python -m http.server 47821
cloudflared tunnel --no-autoupdate run deskwarrant-darsh-pc
```

> **Do not use quick tunnels** (`trycloudflare.com`). They have no uptime
> guarantee, cap in-flight requests at 200, and do not support Server-Sent
> Events — which the assistant's chat streams over.

### 4. Package and autostart (optional)

```powershell
cd agent
.\.venv\Scripts\python.exe -m PyInstaller deskwarrant.spec --noconfirm
.\install.ps1
```

`install.ps1` registers a Scheduled Task named **DeskWarrant Agent** that runs at
logon, unelevated. Pair the agent interactively *before* installing the task —
Task Scheduler gives it no console to prompt on.

---

## Security model

| Concern | Control |
|---|---|
| Device authentication | 32-byte random token, SHA-256 hashed at rest, stored agent-side in Windows Credential Manager, revocable from the dashboard |
| Authorization | Every device-scoped handler verifies `device.userId === session.user.id`. There is no sharing model; this check is the entire authorization layer. |
| Privilege | The agent runs **unelevated**. It cannot touch the lock screen, UAC, or elevate anything. This is a deliberate blast-radius limit. |
| Prompt injection | Window titles, filenames, and UI text are untrusted input. The model selects from a fixed typed tool catalog and never emits shell or code. Arguments are validated with Zod server-side and re-validated agent-side. |
| Filesystem | Hard allowlist of roots, canonicalised path check, system directories denied unconditionally |
| Destructive actions | Explicit user confirmation showing the exact tool and arguments |
| Public exposure | The tunnel runs **only during an active view session**. No session, no reachable endpoint — the hostname stops resolving to anything. |
| Local binding | The agent's live-view server binds `127.0.0.1` exclusively, never `0.0.0.0`, so it is not reachable from the LAN. |
| View authentication | A short-lived token (32 random bytes, SHA-256 at rest, 5-minute TTL) is issued to an authenticated browser and verified by the agent **against the console on every socket connect** — which is what makes revocation instant. |
| Frame confidentiality | TLS to Cloudflare's edge, then Cloudflare's encrypted tunnel to the agent. Frames are never stored. |
| Rate limiting | Per-device caps on job creation, event submission, and view-token issuance |

**On prompt injection specifically:** the structural defence is that the model
cannot express a dangerous action. It picks a name from a 13-entry catalog and
supplies typed arguments; it cannot emit a shell command or a path outside the
allowlist. The system prompt's instruction to treat tool output as data is a
behavioural backstop on top of that, not the primary control. Beneath both,
`kill_process` refuses protected PIDs outright — so even a fully successful
injection saying "kill PID 4" fails closed.

---

## Known limitations

- The agent **cannot see or interact with the lock screen or UAC prompts.** It
  runs unelevated by design.
- The PC must be powered on and online. There is **no remote wake**.
- Some applications draw custom UI with no accessible text, so
  `read_window_text` returns nothing for them. The assistant will say so and
  suggest opening live view.
- Live view uses **WebP tiles, not a hardware video codec**. Text and static
  content are sharp and cheap; fast motion and video playback are choppy. This is
  a deliberate v1 trade with a clear upgrade path to H.264.
- **Primary monitor only.** A `monitorIndex` field is plumbed through so
  multi-monitor is a contained change later.
- The unsigned agent binary **triggers a SmartScreen warning** on download. Click
  *More info → Run anyway*, or sign the binary.
- A chat turn runs inside a Vercel function capped at 60 seconds. Normal turns
  take 4–6 seconds; the ceiling only matters if the PC drops offline mid-turn.

---

## Not in v1

Deliberately excluded: multi-user access or device sharing, multi-monitor, audio
streaming, file transfer, clipboard sync, Wake-on-LAN, lock-screen access,
hardware video codecs, user-authored watch rules, and native mobile apps. A
device belongs to exactly one user, permanently.

`shutdown` and `restart` are **not implemented**, and should only ever be added
behind an explicit per-device opt-in.

---

## Verifying it works

See [CHECKPOINTS.md](CHECKPOINTS.md) for the per-stage verification procedure.
Each stage has a concrete, manually verifiable condition — run them in order.
