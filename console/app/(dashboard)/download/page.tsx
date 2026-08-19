import Link from "next/link";

export const metadata = { title: "Add a PC · DeskWarrant" };

export default function DownloadPage() {
  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Add a PC</h1>
        <p className="mt-2 text-sm text-muted">
          Runs on Windows 10 and 11. Installs for your user only — no
          administrator prompt.
        </p>

        <a
          href="/api/download"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          <DownloadMark />
          Download for Windows
        </a>

        <ol className="mt-8 space-y-5">
          <Step n={1} title="Run the installer">
            It installs to your user folder and sets DeskWarrant to start when
            you log in.
          </Step>
          <Step n={2} title="Approve this PC">
            The agent opens your browser to an approval screen and shows a
            four-character code. Pick the matching code.
          </Step>
          <Step n={3} title="That's it">
            The PC appears in{" "}
            <Link href="/devices" className="text-accent underline underline-offset-4">
              Devices
            </Link>{" "}
            as online. It reconnects on its own after a reboot.
          </Step>
        </ol>

        <div className="mt-10 rounded-xl border border-warn/40 bg-warn/5 p-5">
          <h2 className="text-sm font-medium text-warn">
            Windows will warn you first
          </h2>
          <p className="mt-2 text-sm text-muted">
            The download is not code-signed, so Windows shows{" "}
            <strong className="text-foreground">
              &ldquo;Windows protected your PC&rdquo;
            </strong>
            . This is what an unsigned installer looks like, not a verdict about
            the file.
          </p>
          <p className="mt-3 text-sm text-muted">
            Click{" "}
            <strong className="text-foreground">More info</strong>, then{" "}
            <strong className="text-foreground">Run anyway</strong>. The button
            only appears after <em>More info</em>.
          </p>
          <p className="mt-3 text-xs text-muted">
            Verifying the file:{" "}
            <a
              href="/api/download?flavor=checksums"
              className="text-accent underline underline-offset-4"
            >
              SHA-256 checksums
            </a>{" "}
            are published with every release, and the build that produced them is
            public.
          </p>
        </div>

        <div className="mt-6 rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium">What it can do once paired</h2>
          <p className="mt-2 text-sm text-muted">
            The agent runs unelevated, so it cannot reach the lock screen, UAC
            prompts, or anything needing administrator rights. File access is
            limited to a fixed list of folders that can only be changed on the PC
            itself — never from here.
          </p>
          <p className="mt-3 text-sm text-muted">
            Remove a PC any time from its page in Devices. Revoking takes effect
            on the agent&rsquo;s next poll, within a few seconds.
          </p>
          <p className="mt-3 text-xs text-muted">
            No installer?{" "}
            <a
              href="/api/download?flavor=portable"
              className="text-accent underline underline-offset-4"
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
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-xs font-medium">
        {n}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted">{children}</p>
      </div>
    </li>
  );
}

function DownloadMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
