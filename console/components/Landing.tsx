"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const SHELL = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-16";

/** Type ramps are fluid; the clamps live here so the markup stays readable. */
const H1 = {
  fontSize: "clamp(44px, 7vw, 96px)",
  lineHeight: 1.04,
  letterSpacing: "-0.03em",
  marginLeft: "-0.058em",
} as const;

const H2 = {
  fontSize: "clamp(30px, 3.6vw, 50px)",
  lineHeight: 1.08,
  letterSpacing: "-0.02em",
  marginLeft: "-0.04em",
} as const;

const STAT = {
  fontSize: "clamp(32px, 3.4vw, 46px)",
  lineHeight: 1.05,
  marginLeft: "-0.045em",
} as const;

/** Ask / Act / Watch / Control rows: label · headline · detail. */
const CAPABILITY_ROW = {
  gridTemplateColumns: "minmax(64px, 130px) minmax(0, 380px) minmax(0, 1fr)",
} as const;

const SETUP_ROW = {
  gridTemplateColumns: "minmax(56px, 90px) minmax(0, 1fr) minmax(0, 1.1fr)",
} as const;

export function Landing({ signedIn }: { signedIn: boolean }) {
  const ctaLabel = signedIn ? "Open the console" : "Get started free";
  const ctaHref = signedIn ? "/devices" : "/signin";

  useReveal();

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <CircuitBackground />

      <div className="relative z-10">
        <header className="sticky top-0 z-20 border-b-2 border-border bg-background/85 backdrop-blur-md">
          <div className={`${SHELL} flex items-center gap-6 py-3.5`}>
            <a href="#top" className="flex items-center gap-3 text-foreground">
              <Logo size={30} />
              <span className="text-[18px] font-extrabold tracking-[-0.02em]">
                DeskWarrant
              </span>
            </a>

            <nav className="ml-auto hidden items-center gap-6 lg:flex">
              <NavLink href="#what">What it does</NavLink>
              <NavLink href="#how">How it works</NavLink>
              <NavLink href="#architecture">Architecture</NavLink>
              <NavLink href="#setup">Setup</NavLink>
              <NavLink href="#faq">FAQ</NavLink>
            </nav>

            <div className="ml-auto flex items-center gap-3 lg:ml-0">
              <ThemeToggle />
              <Link href={ctaHref} className={PRIMARY_BTN}>
                {ctaLabel}
              </Link>
            </div>
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        <section id="top" className={`${SHELL} pt-12 sm:pt-20 lg:pt-28`}>
          <p className="kicker">Windows host agent + web console</p>
          <h1 className="mt-5 font-extrabold" style={H1}>
            <span className="block">Your PC, on a leash.</span>
            <span className="block text-accent">From anywhere.</span>
          </h1>
          <p
            className="mt-8 max-w-[58ch] leading-[1.62]"
            style={{ fontSize: "clamp(17px, 1.6vw, 21px)" }}
          >
            DeskWarrant is the remote control your computer never shipped with.
            Ask it questions in plain language, tell it what to do, let it watch
            for the things you care about — and take the mouse yourself when you
            want to. One installer, no domain to own, no ports to forward.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href={ctaHref} className={PRIMARY_BTN_LG}>
              {ctaLabel}
            </Link>
            <a href="#how" className={SECONDARY_BTN_LG}>
              See how it works
            </a>
            <span className="ml-2 text-[13px] uppercase tracking-[0.06em] text-muted">
              Free · no card · no admin rights
            </span>
          </div>

          <dl className="mt-12 grid gap-8 border-y-2 border-border py-10 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))] sm:mt-16 lg:mt-20">
            <Stat value="13" label="Typed actions in the catalog" />
            <Stat value="2s" label="Worst-case dispatch latency" />
            <Stat value="6" label="Watch rules, ready to arm" />
            <Stat value="0" label="Screenshots sent to any model" />
          </dl>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section id="what" className={`${SHELL} pt-14 sm:pt-20 lg:pt-24`}>
          <p className="kicker">Four ways in</p>
          <h2 className="mt-5 max-w-[22ch] font-extrabold" style={H2}>
            Ask. Act. Watch. Control.
          </h2>
          <p className="mt-6 max-w-[58ch] text-[17px] leading-[1.62]">
            Three of them need no video session at all — just text over HTTPS,
            fast enough to use on a phone. The fourth hands you the machine
            itself.
          </p>

          <div className="mt-12 border-t-2 border-border">
            <Capability
              label="Ask"
              title="Plain questions, real answers"
              body={
                <>
                  &ldquo;Is the download finished?&rdquo; &ldquo;What&rsquo;s
                  eating my CPU?&rdquo; &ldquo;Did the render window throw an
                  error?&rdquo; The assistant reads live system data —
                  processes, window titles, folder listings, CPU, RAM, disk,
                  battery, uptime — and answers in a sentence, not a dashboard.
                </>
              }
            >
              <TagRow
                tags={[
                  "list_processes",
                  "list_windows",
                  "read_window_text",
                  "list_folder",
                  "get_system_stats",
                  "get_download_status",
                ]}
              />
            </Capability>

            <Capability
              label="Act"
              title="Say it, and it happens"
              body={
                <>
                  &ldquo;Close Chrome.&rdquo; &ldquo;Turn the volume down to
                  20.&rdquo; &ldquo;Open my Downloads folder.&rdquo; Every
                  action resolves to one entry in a fixed, typed catalog — never
                  a shell command — and anything destructive stops for your
                  explicit confirmation, showing exactly what it is about to
                  run.
                </>
              }
            >
              <TagRow
                tags={[
                  "focus_window",
                  "minimize_window",
                  "open_path",
                  "set_volume",
                ]}
              />
              <TagRow
                className="mt-2"
                tone="accent"
                tags={[
                  "close_window · confirm",
                  "kill_process · confirm",
                  "lock_workstation · confirm",
                ]}
              />
            </Capability>

            <Capability
              label="Watch"
              title="Stop checking. Get told."
              body={
                <>
                  Arm a rule and walk away. Your PC evaluates it locally and
                  pushes a browser notification the moment it fires — so the
                  render finishing, the disk filling or the export closing
                  reaches you instead of you going to look.
                </>
              }
            >
              <div className="mt-4 grid gap-x-7 border-t border-hairline [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
                {[
                  "Download finished",
                  "Program closed",
                  "Program started",
                  "CPU pegged",
                  "Disk space low",
                  "Battery low",
                ].map((rule) => (
                  <p
                    key={rule}
                    className="border-b border-hairline py-2.5 text-[15px]"
                  >
                    {rule}
                  </p>
                ))}
              </div>
            </Capability>

            <Capability
              label="Control"
              title="Take the mouse"
              body={
                <>
                  Open live view and your desktop appears in the browser with
                  full mouse and keyboard. The chat panel stays live beside it,
                  so you can hand off a task and watch it happen. The tunnel
                  starts when you open the view and shuts down seconds after you
                  close it.
                </>
              }
            >
              <TagRow
                tone="neutral"
                tags={[
                  "Sharp WebP tiles",
                  "Mouse + keyboard",
                  "Chat stays live",
                  "Tunnel provisioned for you",
                ]}
              />
            </Capability>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section id="how" className={`${SHELL} pt-14 sm:pt-20 lg:pt-24`}>
          <p className="kicker">The workflow</p>
          <h2 className="mt-5 max-w-[26ch] font-extrabold" style={H2}>
            Install once. Then it is just a conversation.
          </h2>

          <div className="mt-11 grid [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
            <Step
              n="01"
              title="Install it"
              body="Download the installer and run it. It installs for your user only, so there is no administrator prompt at any point, and it registers itself to come back at every logon."
            />
            <Step
              n="02"
              title="Approve the PC"
              body="The agent opens the console in your browser and shows a four-character code. Pick the matching one out of four. Nothing is typed, and a wrong pick denies the request outright."
            />
            <Step
              n="03"
              title="You ask"
              body="Type in plain language from any device. The assistant picks the tools it needs from the catalog, and the arguments are type-checked before anything is queued."
            />
            <Step
              n="04"
              title="You get an answer"
              body="The agent polls every two seconds, and that same poll is the heartbeat behind its online status. A typical turn lands in four to six seconds; armed rules keep firing whether the console is open or not."
            />
          </div>

          <div className="mt-10 border-2 border-border p-6 sm:p-8">
            <p className="kicker">One turn, end to end</p>
            <div className="mt-4 grid gap-0.5 overflow-x-auto font-mono text-[14px] leading-[1.9]">
              <p>
                <span className="font-bold text-accent">you &rsaquo;</span> is
                the export done yet?
              </p>
              <p className="text-muted">
                agent &rsaquo; list_windows() · read_window_text(hwnd: 132918)
              </p>
              <p>
                <span className="font-bold">reply &rsaquo;</span> Premiere is at
                84%, about 6 minutes left. Want me to tell you when it finishes?
              </p>
              <p>
                <span className="font-bold text-accent">you &rsaquo;</span> yes,
                and then close it
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section
          id="architecture"
          className={`${SHELL} pt-14 sm:pt-20 lg:pt-24`}
        >
          <p className="kicker">Architecture</p>
          <h2 className="mt-5 max-w-[24ch] font-extrabold" style={H2}>
            Three moving parts, no mystery.
          </h2>
          <p className="mt-6 max-w-[58ch] text-[17px] leading-[1.62]">
            A browser you open anywhere, a console that handles auth and the
            assistant loop, and a small always-on agent on the Windows machine.
            Frames from live view go straight from your PC to your browser —
            they never pass through the console and are never stored.
          </p>

          <div className="mt-11 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            <Layer
              n="Layer 01"
              title="Browser"
              body="Any device. Chat, watch rules, event feed and the live canvas. Installable as a web app, with push notifications."
              foot="HTTPS · WebSocket"
            />
            <Layer
              n="Layer 02"
              title="Console"
              body="Sign-in, devices, the assistant loop and the job queue. It validates every tool call before dispatch, provisions each PC its own tunnel, and stores the transcript — never a frame."
              foot="Next.js · Postgres"
            />
            <Layer
              n="Layer 03"
              title="Host agent"
              body="A quiet tray app on Windows. Executes the tools, evaluates the rules, captures the screen. Runs unelevated and binds to localhost only."
              foot="Python · outbound only"
            />
          </div>

          <div className="mt-6 grid gap-6 border-2 border-border p-6 sm:p-8">
            <div>
              <p className="text-[12px] uppercase tracking-[0.1em] text-muted">
                Path A — ask, act, watch
              </p>
              <FlowRow
                nodes={["Browser", "Console", "Job queue", "Agent polls, 2s"]}
              />
            </div>
            <hr className="h-0.5 border-0 bg-border" />
            <div>
              <p className="text-[12px] uppercase tracking-[0.1em] text-muted">
                Path B — live view
              </p>
              <FlowRow
                nodes={["Your PC", "Encrypted tunnel", "Browser"]}
                badge="Console never sees a frame"
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className={`${SHELL} pt-14 sm:pt-20 lg:pt-24`}>
          <div className="grid gap-8 border-t-2 border-border pt-11 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))] lg:gap-x-[72px]">
            <div>
              <p className="kicker">Built to be trusted</p>
              <h2
                className="mt-5 font-extrabold"
                style={{ ...H2, fontSize: "clamp(28px, 3.2vw, 44px)" }}
              >
                Your screen is never sent to an AI model.
              </h2>
              <p className="mt-6 text-[17px] leading-[1.62]">
                The assistant only ever receives text: process names, window
                titles, file listings, numbers. There is no vision model
                anywhere in this system, and live view frames are never written
                to a database.
              </p>
            </div>
            <div className="grid content-start">
              <Trust
                title="A catalog, not a shell"
                body="The model can only name one of 13 typed tools. It cannot emit a command, a script, or a path outside your allowlist."
              />
              <Trust
                title="Folders you choose"
                body="Downloads, Documents and Desktop by default. The list can only be widened at the machine itself — never remotely, never by the assistant."
              />
              <Trust
                title="Reachable only while watching"
                body="The tunnel opens when you start live view and closes seconds after you stop. No session, no public endpoint."
              />
              <Trust
                title="Approval is not a credential"
                body="Approving a pairing request mints nothing. The PC has to come back and prove it holds a 32-byte secret before a device token exists at all — and that token is hashed at rest and revocable in a click."
                last
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section id="setup" className={`${SHELL} pt-14 sm:pt-20 lg:pt-24`}>
          <p className="kicker">Setup</p>
          <h2 className="mt-5 max-w-[22ch] font-extrabold" style={H2}>
            Two steps, once.
          </h2>
          <p className="mt-6 max-w-[58ch] text-[17px] leading-[1.62]">
            No Python, no terminal, no config file. Ask, Act, Watch and Control
            all work the moment the PC is approved.
          </p>

          <div className="mt-11 border-t-2 border-border">
            <SetupStep
              n="STEP 01"
              title="Sign in and get the installer"
              body={
                <>
                  Google sign-in, then <strong>Add a PC</strong>. Your dashboard
                  is live before the agent is even installed.
                </>
              }
              terminal={[
                "deskwarrant › sign in with Google",
                "› add a PC",
                "› download for Windows",
              ]}
            />
            <SetupStep
              n="STEP 02"
              title="Run it on the PC"
              body={
                <>
                  It installs to your user folder — no administrator prompt —
                  then opens the console in your browser and shows a
                  four-character code. Pick the matching one and the machine
                  turns ONLINE.
                </>
              }
              terminal={[
                "> DeskWarrantSetup.exe",
                "installing for this user…",
                "opening console…",
                "match code: 7F2A → approved, ONLINE",
              ]}
            />
            <SetupStep
              n="STEP 03"
              title="There is no step three"
              dim
              body={
                <>
                  Live view needs no domain, no <code>cloudflared</code>, no
                  port forwarding. When the PC pairs, the console provisions its
                  own tunnel and private subdomain through the Cloudflare API —
                  and the credential that does it never leaves the server.
                </>
              }
              terminal={[
                "tunnel:   provisioned automatically",
                "hostname: pc-7f2a.<console domain>",
                "service:  http://127.0.0.1:47821",
              ]}
            />
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href={ctaHref} className={PRIMARY_BTN_LG}>
              {ctaLabel}
            </Link>
            <span className="text-[15px] text-muted">
              Windows 10 or 11 · no admin rights · no Python, no terminal
            </span>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section id="faq" className={`${SHELL} py-14 sm:py-20 lg:py-24`}>
          <p className="kicker">FAQ</p>
          <h2 className="mt-5 mb-11 font-extrabold" style={H2}>
            Straight answers.
          </h2>
          <div className="grid border-t-2 border-border [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))] lg:gap-x-[72px]">
            <Faq q="Does the AI see my screen?">
              No. It receives text only — names, titles, listings and numbers.
              There is no vision model in the product at all.
            </Faq>
            <Faq q="Can it delete my files?">
              There is no delete tool. It can list folders and open files inside
              the folders you allow, and nothing else.
            </Faq>
            <Faq q="Do I need a domain or a Cloudflare account?">
              No. Each PC is given its own tunnel and its own private subdomain
              when it pairs, provisioned by the console. You never install
              cloudflared and never log into anything.
            </Faq>
            <Faq q="Will Windows warn me when I install it?">
              Yes. The build is not code-signed, so you get{" "}
              <em>&ldquo;Windows protected your PC&rdquo;</em> — click{" "}
              <strong>More info</strong>, then <strong>Run anyway</strong>.
              SHA-256 checksums are published with every release.
            </Faq>
            <Faq q="Does it work on my phone?">
              Yes — it is a web app, installable to your home screen, with push
              notifications for watch rules. Live view included.
            </Faq>
            <Faq q="Windows only?">
              The agent is Windows 10 and 11 today. The console runs in any
              modern browser on any platform.
            </Faq>
            <Faq q="What if the PC is asleep?">
              It needs to be awake and online. The console shows the machine as
              offline the moment its heartbeat stops, and there is no remote
              wake.
            </Faq>
            <Faq q="Can someone else reach my PC?">
              A device belongs to exactly one account, and live view needs a
              short-lived token that your PC re-checks with the console on every
              connect. Revoke it and access ends instantly.
            </Faq>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="bg-accent text-white">
          <div className={`${SHELL} py-14 sm:py-20 lg:py-24`}>
            <h2
              className="max-w-[20ch] font-extrabold"
              style={{
                fontSize: "clamp(38px, 6vw, 82px)",
                lineHeight: 1.05,
                letterSpacing: "-0.03em",
                marginLeft: "-0.058em",
              }}
            >
              <span className="block">Stop walking</span>
              <span className="block">back to your desk.</span>
            </h2>
            <p
              className="mt-8 max-w-[50ch] leading-[1.6] text-white/90"
              style={{ fontSize: "clamp(17px, 1.6vw, 20px)" }}
            >
              Pair your machine and ask it something from the sofa, the train,
              or the other side of the world.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={ctaHref}
                className="inline-flex items-center border-2 border-white bg-white px-5 py-3.5 text-[16px] font-extrabold text-accent"
              >
                {ctaLabel}
              </Link>
              <a
                href="#what"
                className="inline-flex items-center border-2 border-white/70 px-5 py-3.5 text-[16px] font-extrabold text-white transition-colors hover:border-white"
              >
                Read the whole story
              </a>
            </div>
          </div>
        </section>

        <footer className="border-t-2 border-border">
          <div
            className={`${SHELL} flex flex-wrap items-center gap-x-10 gap-y-5 py-8`}
          >
            <span className="flex items-center gap-2.5">
              <Logo size={22} />
              <span className="text-[15px] font-extrabold">DeskWarrant</span>
            </span>
            <span className="text-[14px] text-muted">
              Your PC, on a leash. From anywhere.
            </span>
            <span className="text-[14px] text-muted">
              Developed by{" "}
              <a
                href="https://www.darshtank.in"
                target="_blank"
                rel="noopener noreferrer"
                className="border-b border-accent/50 text-accent-soft transition-colors hover:text-accent"
              >
                Darsh Tank
              </a>
            </span>
            <span className="ml-auto flex flex-wrap gap-5 text-[14px]">
              <NavLink href="#what">What it does</NavLink>
              <NavLink href="#architecture">Architecture</NavLink>
              <NavLink href="#setup">Setup</NavLink>
              <NavLink href="#faq">FAQ</NavLink>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* pieces                                                                     */
/* ========================================================================== */

const PRIMARY_BTN =
  "inline-flex items-center border-2 border-accent bg-accent px-4 py-2 text-[14px] font-extrabold text-accent-fg transition-opacity hover:opacity-90";

const PRIMARY_BTN_LG =
  "inline-flex items-center border-2 border-accent bg-accent px-5 py-3.5 text-[16px] font-extrabold text-accent-fg transition-opacity hover:opacity-90";

const SECONDARY_BTN_LG =
  "inline-flex items-center border-2 border-border px-5 py-3.5 text-[16px] font-extrabold text-foreground transition-colors hover:border-accent hover:text-accent";

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="whitespace-nowrap text-[14px] text-foreground transition-colors hover:text-accent"
    >
      {children}
    </a>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dd className="font-extrabold text-accent" style={STAT}>
        {value}
      </dd>
      <dt className="mt-3 text-[13px] uppercase leading-[1.3] tracking-[0.08em] text-muted">
        {label}
      </dt>
    </div>
  );
}

function Capability({
  label,
  title,
  body,
  children,
}: {
  label: string;
  title: string;
  body: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="dw-reveal grid items-start gap-5 border-b-2 border-border py-9 sm:gap-x-8 lg:gap-x-16"
      style={CAPABILITY_ROW}
    >
      <div className="flex items-center gap-3">
        <span className="mark" />
        <span className="text-[15px] font-extrabold uppercase tracking-[0.06em]">
          {label}
        </span>
      </div>
      <h3
        className="font-bold leading-[1.2] tracking-[-0.015em]"
        style={{ fontSize: "clamp(21px, 2vw, 27px)" }}
      >
        {title}
      </h3>
      <div>
        <p className="text-[16px] leading-[1.6]">{body}</p>
        {children}
      </div>
    </div>
  );
}

function TagRow({
  tags,
  tone = "outline",
  className = "mt-4",
}: {
  tags: string[];
  tone?: "outline" | "accent" | "neutral";
  className?: string;
}) {
  const toneClass =
    tone === "accent"
      ? "border-accent bg-accent-wash text-accent-soft"
      : tone === "neutral"
        ? "border-hairline bg-surface text-foreground"
        : "border-accent text-accent-soft";
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {tags.map((tag) => (
        <span
          key={tag}
          className={`inline-flex items-center border px-2.5 py-1 font-mono text-[11px] ${toneClass}`}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="dw-reveal border-t-2 border-border py-7 pr-6 sm:pr-8">
      <p className="text-[13px] font-extrabold tracking-[0.08em] text-accent">
        {n}
      </p>
      <h3 className="mt-4 text-[20px] font-bold leading-[1.25]">{title}</h3>
      <p className="mt-3 text-[15px] leading-[1.6]">{body}</p>
    </div>
  );
}

function Layer({
  n,
  title,
  body,
  foot,
}: {
  n: string;
  title: string;
  body: string;
  foot: string;
}) {
  return (
    <div className="flex flex-col gap-3.5 border-2 border-border p-6">
      <p className="text-[12px] uppercase tracking-[0.1em] text-muted">{n}</p>
      <h3 className="text-[22px] font-extrabold leading-[1.2]">{title}</h3>
      <p className="text-[15px] leading-[1.6]">{body}</p>
      <p className="mt-auto text-[13px] uppercase tracking-[0.06em] text-accent-soft">
        {foot}
      </p>
    </div>
  );
}

function FlowRow({ nodes, badge }: { nodes: string[]; badge?: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[14px] font-bold uppercase tracking-[0.04em]">
      {nodes.map((node, i) => (
        <span key={node} className="flex items-center gap-2.5">
          <span className="border-2 border-foreground px-3.5 py-2">{node}</span>
          {i < nodes.length - 1 && (
            <span className="text-accent" aria-hidden="true">
              ──▸
            </span>
          )}
        </span>
      ))}
      {badge && (
        <span className="bg-accent px-3.5 py-2 text-accent-fg">{badge}</span>
      )}
    </div>
  );
}

function Trust({
  title,
  body,
  last = false,
}: {
  title: string;
  body: string;
  last?: boolean;
}) {
  return (
    <div className={`border-t border-hairline py-4 ${last ? "border-b" : ""}`}>
      <h3 className="text-[16px] font-bold">{title}</h3>
      <p className="mt-1.5 text-[15px] leading-[1.55]">{body}</p>
    </div>
  );
}

function SetupStep({
  n,
  title,
  body,
  terminal,
  dim = false,
}: {
  n: string;
  title: string;
  body: React.ReactNode;
  terminal: string[];
  dim?: boolean;
}) {
  return (
    <div
      className="grid items-start gap-4 border-b-2 border-border py-8 sm:gap-x-8 lg:gap-x-14"
      style={SETUP_ROW}
    >
      <p
        className={`text-[15px] font-extrabold ${dim ? "text-muted" : "text-accent"}`}
      >
        {n}
      </p>
      <div>
        <h3 className="text-[20px] font-bold">{title}</h3>
        <p className="mt-2.5 text-[15px] leading-[1.6]">{body}</p>
      </div>
      <pre
        className={`overflow-x-auto border-l-2 pl-4 font-mono text-[13px] leading-[1.7] whitespace-pre-wrap text-muted ${
          dim ? "border-hairline" : "border-accent"
        }`}
      >
        {terminal.join("\n")}
      </pre>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="border-b-2 border-border py-7">
      <h3 className="text-[18px] font-bold">{q}</h3>
      <p className="mt-2.5 text-[15px] leading-[1.6]">{children}</p>
    </div>
  );
}

/**
 * The background: five horizontal wires with a pulse travelling along each,
 * two verticals, and nodes where they cross. Fixed, behind everything, and
 * inert — it is scenery, and `prefers-reduced-motion` stops it dead.
 */
function CircuitBackground() {
  return (
    <div
      className="dw-bg pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {WIRES.map((wire) => (
        <div
          key={wire.top}
          className="absolute inset-x-0 h-px"
          style={{
            top: wire.top,
            background: "color-mix(in srgb, var(--foreground) 4%, transparent)",
          }}
        >
          <span
            className="absolute left-0"
            style={{
              top: -3,
              width: wire.w,
              height: 4,
              background: wire.accent ? "var(--accent)" : "var(--foreground)",
              opacity: wire.accent ? 0.16 : 0.08,
              animation: `${wire.back ? "dw-wire-back" : "dw-wire"} ${wire.dur}s linear infinite ${wire.delay}s`,
            }}
          />
        </div>
      ))}

      <div
        className="absolute inset-y-0 w-px"
        style={{
          left: "18%",
          background: "color-mix(in srgb, var(--foreground) 3%, transparent)",
        }}
      />
      <div
        className="absolute inset-y-0 w-px"
        style={{
          left: "72%",
          background: "color-mix(in srgb, var(--foreground) 3%, transparent)",
        }}
      />

      {NODES.map((node) => (
        <div
          key={`${node.top}-${node.left}`}
          className="absolute"
          style={{
            top: node.top,
            left: node.left,
            width: node.size,
            height: node.size,
            margin: `${-node.size / 2}px 0 0 ${-node.size / 2}px`,
            background: node.accent ? "var(--accent)" : "var(--foreground)",
            opacity: node.accent ? 1 : 0.12,
            animation: `dw-node ${node.dur}s ease-in-out infinite ${node.delay}s`,
          }}
        />
      ))}

      <div
        className="absolute"
        style={{
          top: "29%",
          left: "72%",
          width: 8,
          height: 16,
          margin: "-8px 0 0 -4px",
          background: "var(--accent)",
          opacity: 0.1,
          animation: "dw-blink 2.2s steps(1) infinite",
        }}
      />
    </div>
  );
}

const WIRES = [
  { top: "13%", w: 34, dur: 13, delay: 0, accent: true, back: false },
  { top: "29%", w: 18, dur: 19, delay: 0, accent: false, back: true },
  { top: "46%", w: 48, dur: 21, delay: 2, accent: true, back: false },
  { top: "62%", w: 22, dur: 27, delay: 4, accent: false, back: true },
  { top: "81%", w: 28, dur: 17, delay: 6, accent: true, back: false },
];

const NODES = [
  { top: "13%", left: "18%", size: 6, dur: 6, delay: 0, accent: true },
  { top: "46%", left: "72%", size: 7, dur: 9, delay: 1.5, accent: true },
  { top: "81%", left: "18%", size: 5, dur: 11, delay: 3, accent: false },
];

/**
 * Fades sections in as they arrive. Anything already above the fold on load is
 * left painted — animating it would be a flash of missing content, not a
 * reveal.
 */
function useReveal() {
  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(".dw-reveal"),
    );
    if (nodes.length === 0) return;

    if (
      typeof IntersectionObserver !== "function" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      nodes.forEach((n) => {
        n.dataset.shown = "true";
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).dataset.shown = "true";
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    nodes.forEach((n) => {
      if (n.getBoundingClientRect().top < window.innerHeight * 0.9) {
        n.dataset.shown = "true";
        return;
      }
      observer.observe(n);
    });

    return () => observer.disconnect();
  }, []);
}
