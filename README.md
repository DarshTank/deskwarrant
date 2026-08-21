# DeskWarrant

**Natural-language PC agent with remote control.**

A Windows PC runs a small always-on host agent. You reach that PC from a web app
on any other device — laptop, desktop, or phone — and can:

- **Ask** questions in plain language ("is the download finished?", "what's using
  my CPU?") and get answers derived from real system data.
- **Act** through natural language ("close Chrome"), executed from a fixed, typed
  action catalog.
- **Watch** — the PC pushes notifications when predefined conditions occur.
- **Control** — a live screen view with mouse and keyboard, windowed or full
  screen with the remote pointer drawn in.

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
│  Browser       │         │  Console (Vercel)        │         │  Supabase PG │
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

You need five things, all free-tier: a **Supabase** Postgres database, a
**Google OAuth** client, a **Groq** API key, a **VAPID** key pair, and — for
live view only — a **domain on Cloudflare's free plan**. No card is required for
any of them.

> **Why Supabase specifically.** The host agent polls every 2 seconds, so the
> database is never idle. That rules out any free tier metered per operation or
> per compute-hour — the agent exhausts a 100k-operation monthly quota in about
> eleven hours of uptime, and a 100 CU-hour quota in about sixteen days.
> Supabase bills a fixed always-on instance with no request meter, and its
> seven-day inactivity pause can never trigger while an agent is running.

### 1. Console environment

```bash
cd console
cp .env.example .env      # then fill it in
```

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Supabase → Connect → **Transaction pooler** (port `6543`). Must end with `?pgbouncer=true&connection_limit=1`. |
| `DIRECT_URL` | Supabase → Connect → **Session pooler** (port `5432`). Used by `prisma migrate` only. |
| `AUTH_SECRET` | `npx auth secret` |
| `AUTH_URL` | `http://localhost:3000`, or your Vercel URL in production |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google Cloud Console → Credentials → OAuth 2.0 Client (Web). Authorized redirect URI must be `<AUTH_URL>/api/auth/callback/google` |
| `GROQ_API_KEY` | console.groq.com/keys |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Same value as `VAPID_PUBLIC_KEY` |

> **The two database URLs are not interchangeable.** Prisma on Vercel needs the
> transaction pooler at runtime and a session-mode connection for migrations.
> Getting this wrong causes intermittent connection failures under serverless
> load — a failure mode that looks like flakiness rather than misconfiguration.
>
> Two Supabase-specific traps live here:
>
> - **`pgbouncer=true` is mandatory on `DATABASE_URL`.** Transaction mode cannot
>   hold prepared statements, which Prisma creates by default. Omit the flag and
>   you get sporadic `prepared statement "s0" already exists` errors that only
>   appear under concurrency.
> - **Use the *session pooler* for `DIRECT_URL`, not the raw direct host.** The
>   raw host (`db.PROJECTREF.supabase.co:5432`) is IPv6-only unless you buy the
>   IPv4 add-on, so `prisma migrate` fails with `ENETUNREACH` on most laptops and
>   CI runners. The session pooler resolves over IPv4 and behaves identically for
>   migrations.

Then:

```bash
npm install
npx prisma migrate deploy    # applies the existing migrations to Supabase
npm run dev
```

`migrate deploy` replays the committed migrations in `prisma/migrations/`. Use
`migrate dev` only when you are changing the schema — against a fresh Supabase
project it would try to author a new migration rather than apply the five that
already exist.

### 2. Host agent

On the Windows PC:

```powershell
cd agent
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

On first run the agent opens your browser to an approval screen and prints a
four-character code. Pick the matching code in the console and the PC appears as
ONLINE. Nothing is typed.

The direction matters: the PC asks to join, and you approve. The older flow —
console mints a code, you carry it to the PC — made a human the transport for a
secret, which is why it needed a terminal to prompt on and why the agent could
not be installed as a scheduled task before it was paired.

**The match code is an anti-phishing step, not a password.** Anyone can open a
claim, so being sent someone else's approval link is the attack to design out. A
person looking at the PC can answer the challenge; a person who was sent a link
cannot, and a wrong pick denies the request outright rather than allowing
another guess.

Two fallbacks, in order of how often you will need them:

- **No browser opens** (Task Scheduler, RDP, no default browser) — the link and
  code are printed, written to `agent.log`, and reachable from the tray icon's
  *Finish pairing…* item. Open it on your phone.
- **No browser anywhere near the PC** — reveal *Pair with a typed code instead*
  in the console and run `main.py --pair --code ABC123`.

Set `DESKWARRANT_CONSOLE_URL`, or bake `DEFAULT_CONSOLE_URL` into
[agent/config.py](agent/config.py) at build time, so a fresh install has nothing
to type at all. Without it the agent asks for the console URL once.

The device token is stored in **Windows Credential Manager** under the service
name `DeskWarrant` — never in `config.json`, never in the repo. The claim secret
that redeems a pairing request is treated the same way: 32 random bytes, hashed
at rest, and never displayed, which is exactly why it can be 32 bytes where a
typed code has to be six readable characters.

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

### 4. Package and autostart

For yourself, from source:

```powershell
cd agent
.\.venv\Scripts\python.exe -m PyInstaller deskwarrant.spec --noconfirm
.\install.ps1
```

`install.ps1` registers a Scheduled Task named **DeskWarrant Agent** that runs at
logon, unelevated. Pairing order no longer matters: the agent surfaces its
approval link through the tray icon, so an unpaired PC can be installed first
and approved afterwards.

For everyone else, see **Shipping to other people** below.

---

## Shipping to other people

Someone who signs up has no repo, no Python, and no terminal. The chain that
gets the agent onto their PC is built entirely from free tools.

**Build** — [`.github/workflows/release.yml`](.github/workflows/release.yml)
runs on `windows-latest` when you push a `v*` tag. It fetches `cloudflared`,
bakes the console URL in, runs PyInstaller, builds the installer with Inno
Setup, and publishes all three artifacts to a GitHub Release.

One-time setup: add a repository **variable** named `CONSOLE_URL` under
*Settings → Secrets and variables → Actions → Variables*, holding the console's
public URL. The workflow fails with an explicit message if it is missing, rather
than shipping a binary that prompts the user for a URL.

```powershell
git tag v0.1.0
git push origin v0.1.0
```

**Distribute** — `GET /api/download` redirects to
`releases/latest/download/DeskWarrantSetup.exe`. A redirect and not a proxy: the
binary is ~60 MB, far past what a serverless function may return, so GitHub
serves the bytes and Vercel serves a few hundred of them. GitHub resolves
`latest` itself, so shipping a new version never touches the console.

> **The repository must be public** for this to work. Release assets on a
> private repo require authentication, and a new user's browser has none.

**Install** — [`agent/installer.iss`](agent/installer.iss) installs per-user into
`%LOCALAPPDATA%\Programs`, so there is **no UAC prompt at any point**. That is
not only friendlier: the agent is deliberately unelevated, and asking for admin
to install it would claim a privilege the product neither wants nor uses. The
installer registers the logon task, adds an Add/Remove Programs entry, and
launches the agent, which flows straight into pairing.

**What this does not solve: SmartScreen.** The binary is unsigned, so Windows
shows *"Windows protected your PC"* and hides *Run anyway* behind *More info*.
`/download` shows users exactly that, in advance — an ambush converts far worse
than a warning. Certificates cost real money (OV ~$200–400/yr; EV, the one that
clears SmartScreen immediately, ~$300–600/yr plus a hardware token). The one
free route is **SignPath Foundation**, which signs open-source projects at no
cost and is worth an application now that the repo is public.

---

## Security model

| Concern | Control |
|---|---|
| Device authentication | 32-byte random token, SHA-256 hashed at rest, stored agent-side in Windows Credential Manager, revocable from the dashboard |
| Pairing | The PC opens a claim and gets a 32-byte secret; approving only marks the claim, so no device token exists anywhere — not even encrypted — until the agent returns and proves it holds that secret. Claims expire in 10 minutes and are rate-limited per source IP, the one endpoint that writes with no credential at all. |
| Pairing consent | A four-character code shown on the PC, matched against four choices in the console. One attempt: a wrong pick denies the claim. This is what stops a device-flow phishing link from enrolling a stranger's PC into your account. |
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
cannot express a dangerous action. It picks a name from a 21-entry catalog and
supplies typed arguments; it cannot emit a shell command or a path outside the
allowlist. Where a tool must reach something the filesystem allowlist cannot
name, it takes an opaque id instead of a path: `launch_app` accepts only an
`appId` that `list_apps` produced, the same indirection `hwnd` and `pid`
already use, so an injected instruction cannot name a target that was never
listed. Shells, terminals, and language interpreters are excluded from that
listing outright. The system prompt's instruction to treat tool output as data is a
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
  *More info → Run anyway*, or sign the binary. Some antivirus engines also flag
  PyInstaller bundles heuristically, because malware authors use PyInstaller too.
- Every paired PC gets its own Cloudflare tunnel and DNS record **on your zone,
  provisioned with your API token**. Fine at personal scale; it is the first
  thing that breaks if the app gets real users, along with Groq usage, which all
  runs on the operator's single key.
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
