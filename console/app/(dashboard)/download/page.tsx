import Link from "next/link";

export const metadata = { title: "Add a PC · DeskWarrant" };

export default function DownloadPage() {
  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <p className="kicker">Add a PC</p>
        <h1
          className="mt-4 font-extrabold"
          style={{
            fontSize: "clamp(30px, 4.4vw, 44px)",
            lineHeight: 1.06,
            letterSpacing: "-0.03em",
            marginLeft: "-0.04em",
          }}
        >
          One installer. No admin prompt.
        </h1>
        <p className="mt-4 max-w-[56ch] text-[16px] leading-[1.6] text-muted">
          Runs on Windows 10 and 11. It installs for your user only, starts at
          every logon, and needs no Python, no terminal and no config file.
        </p>

        <a
          href="/api/download"
          className="mt-7 inline-flex items-center gap-2.5 border-2 border-accent bg-accent px-6 py-3.5 text-[16px] font-extrabold text-accent-fg transition-opacity hover:opacity-90"
        >
          <DownloadMark />
          Download for Windows
        </a>

        <div className="mt-12 border-t-2 border-border">
          <Step n="STEP 01" title="Run the installer">
            It installs to your user folder and registers DeskWarrant to start
            when you log in. There is no administrator prompt at any point — the
            agent is deliberately unelevated, so asking for admin would claim a
            privilege it never uses.
          </Step>
          <Step n="STEP 02" title="Approve this PC">
            The agent opens your browser to an approval screen and shows a
            four-character code. Pick the matching one out of four. A wrong pick
            denies the request outright, which is what stops a mailed link from
            enrolling someone else&rsquo;s PC into your account.
          </Step>
          <Step n="STEP 03" title="That is it">
            The PC appears in{" "}
            <Link
              href="/devices"
              className="border-b border-accent/50 text-accent-soft transition-colors hover:text-accent"
            >
              Devices
            </Link>{" "}
            as online, and reconnects on its own after a reboot. Live view needs
            nothing extra — its tunnel and private subdomain are provisioned
            when the PC pairs.
          </Step>
        </div>

        <div className="mt-10 border-2 border-warn/60 bg-warn/5 p-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-warn">
            Windows will warn you first
          </p>
          <h2 className="mt-3 text-[20px] font-bold">
            &ldquo;Windows protected your PC&rdquo; is expected here.
          </h2>
          <p className="mt-3 text-[15px] leading-[1.6] text-muted">
            The download is not code-signed, so Windows shows that banner. It is
            what an unsigned installer looks like, not a verdict about the file.
          </p>
          <p className="mt-3 text-[15px] leading-[1.6] text-muted">
            Click <strong className="text-foreground">More info</strong>, then{" "}
            <strong className="text-foreground">Run anyway</strong>. The button
            only appears after <em>More info</em>.
          </p>
          <p className="mt-4 border-t border-hairline pt-4 text-[13px] text-muted">
            Verifying the file:{" "}
            <a
              href="/api/download?flavor=checksums"
              className="border-b border-accent/50 text-accent-soft transition-colors hover:text-accent"
            >
              SHA-256 checksums
            </a>{" "}
            are published with every release, and the build that produced them
            is public.
          </p>
        </div>

        <div className="mt-6 border-2 border-border bg-surface p-6">
          <p className="kicker kicker-muted">Once paired</p>
          <h2 className="mt-3 text-[20px] font-bold">What it can and cannot do</h2>
          <p className="mt-3 text-[15px] leading-[1.6] text-muted">
            The agent runs unelevated, so it cannot reach the lock screen, UAC
            prompts, or anything needing administrator rights. File access is
            limited to a fixed list of folders that can only be widened on the PC
            itself — never from here, and never by the assistant.
          </p>
          <p className="mt-3 text-[15px] leading-[1.6] text-muted">
            Remove a PC any time from its page in Devices. Revoking takes effect
            on the agent&rsquo;s next poll, within a few seconds.
          </p>
          <p className="mt-4 border-t border-hairline pt-4 text-[13px] text-muted">
            No installer?{" "}
            <a
              href="/api/download?flavor=portable"
              className="border-b border-accent/50 text-accent-soft transition-colors hover:text-accent"
            >
              Download the agent on its own
            </a>{" "}
            — same program, but it will not start automatically after a reboot.
          </p>
        </div>
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-start gap-x-6 gap-y-2 border-b-2 border-border py-7 sm:[grid-template-columns:minmax(70px,90px)_minmax(0,1fr)]">
      <p className="text-[14px] font-extrabold tracking-[0.06em] text-accent">
        {n}
      </p>
      <div>
        <h2 className="text-[19px] font-bold">{title}</h2>
        <p className="mt-2 text-[15px] leading-[1.6] text-muted">{children}</p>
      </div>
    </div>
  );
}

function DownloadMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
