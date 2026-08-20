import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ButtonAnchor, ButtonLink, Eyebrow, PageHeading } from "@/components/ui";

export const metadata = { title: "Add a PC · DeskWarrant" };

export default async function DownloadPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  const downloadHref = signedIn ? "/api/download" : "/signin?next=/download";
  const portableHref = signedIn
    ? "/api/download?flavor=portable"
    : "/signin?next=/download";

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      {/* Universal Top Navigation Header */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/[0.88] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-3 text-ink"
            title="Back to home"
          >
            <Logo size={34} />
            <span className="font-serif text-[22px] tracking-[-0.01em] leading-none">
              DeskWarrant
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <ThemeToggle className="p-1.5" />
            {signedIn ? (
              <div className="flex items-center gap-3">
                <Link
                  href="/devices"
                  className="rounded-full bg-ink px-4 py-2 text-[14px] font-medium text-paper transition-opacity hover:opacity-85"
                >
                  Go to Console
                </Link>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/" });
                  }}
                  className="hidden sm:block"
                >
                  <button
                    type="submit"
                    className="rounded-full border border-line px-3.5 py-1.5 text-[13px] text-soft transition-colors hover:text-ink"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <Link
                href="/signin?next=/download"
                className="rounded-full bg-ink px-4 py-2 text-[14px] font-medium text-paper transition-opacity hover:opacity-85"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Download Content */}
      <main className="thin-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-[clamp(16px,4vw,40px)] py-8 sm:py-12">
          {/* Sign in required alert banner for unauthenticated visitors */}
          {!signedIn && (
            <div className="mb-8 flex flex-col items-start justify-between gap-3.5 rounded-2xl border border-signal/30 bg-signal-soft/40 p-4.5 sm:flex-row sm:items-center sm:p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-signal text-paper">
                  <LockGlyph />
                </span>
                <p className="text-[14.5px] text-ink">
                  <strong className="font-medium">Sign in required to download.</strong>{" "}
                  <span className="text-soft">
                    You must sign in to connect and authorize this PC to your account.
                  </span>
                </p>
              </div>
              <Link
                href="/signin?next=/download"
                className="shrink-0 rounded-full bg-signal px-4 py-1.5 text-[13.5px] font-medium whitespace-nowrap text-paper transition-opacity hover:opacity-90"
              >
                Sign in to continue →
              </Link>
            </div>
          )}

          <PageHeading
            eyebrow="Add a PC"
            title="One installer. No admin prompt."
            meta="windows 10 · windows 11 · per-user install"
          />

          <p className="mt-6 max-w-[54ch] text-[16px] text-soft">
            It installs to your user folder, starts at every logon, and needs no
            Python, no terminal and no config file. Live view needs nothing extra
            either — the tunnel and a private subdomain are provisioned the moment
            the machine pairs.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            {signedIn ? (
              <ButtonAnchor href={downloadHref} variant="primary" size="lg">
                <DownloadGlyph />
                Download for Windows
              </ButtonAnchor>
            ) : (
              <ButtonLink href={downloadHref} variant="primary" size="lg">
                <LockGlyph />
                Sign in to Download for Windows
              </ButtonLink>
            )}

            <Link
              href={portableHref}
              className="text-[14px] text-soft transition-colors hover:text-ink"
            >
              {signedIn
                ? "Or the agent on its own →"
                : "Or sign in for portable build →"}
            </Link>
          </div>

          {/* Three steps as a numbered ledger */}
          <ol className="mt-12">
            {STEPS.map((step) => (
              <li
                key={step.title}
                className="grid grid-cols-[46px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 border-t border-line py-6 last:border-b sm:grid-cols-[72px_minmax(0,240px)_minmax(0,1fr)] sm:gap-x-8"
              >
                <span className="font-serif text-[32px] leading-none text-numeral">
                  {step.n}
                </span>
                <h2 className="text-[18px] font-medium">{step.title}</h2>
                <p className="col-start-2 max-w-[54ch] text-[15px] text-soft sm:col-start-3">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>

          <section className="mt-10 rounded-2xl border border-warn/30 bg-warn/[0.06] p-6 sm:p-7">
            <Eyebrow className="text-warn">Expect this</Eyebrow>
            <h2 className="mt-3 font-serif text-[clamp(22px,3vw,28px)] leading-tight tracking-[-0.02em]">
              Windows will warn you first.
            </h2>
            <p className="mt-4 max-w-[58ch] text-[15px] text-soft">
              The build is not code-signed, so Windows shows{" "}
              <strong className="font-medium text-ink">
                &ldquo;Windows protected your PC&rdquo;
              </strong>
              . That is what an unsigned installer looks like, not a verdict about
              the file. Click{" "}
              <strong className="font-medium text-ink">More info</strong>, then{" "}
              <strong className="font-medium text-ink">Run anyway</strong> — the
              button only appears after <em>More info</em>.
            </p>
            <p className="mt-4 border-t border-warn/20 pt-4 text-[13.5px] text-soft">
              Verifying it:{" "}
              <a
                href="https://github.com/DarshTank/deskwarrant/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="border-b border-line text-ink transition-colors hover:text-signal"
              >
                SHA-256 checksums
              </a>{" "}
              are published with every release, and the build that produced them
              is public.
            </p>
          </section>

          <section className="mt-6 rounded-2xl border border-line bg-raised p-6 sm:p-7">
            <Eyebrow>Once paired</Eyebrow>
            <h2 className="mt-3 font-serif text-[clamp(22px,3vw,28px)] leading-tight tracking-[-0.02em]">
              What it can, and cannot, do.
            </h2>
            <dl className="mt-5 grid gap-x-10 gap-y-4 sm:grid-cols-2">
              {LIMITS.map((limit) => (
                <div key={limit.title} className="border-t border-line2 pt-3.5">
                  <dt className="text-[15px] font-medium">{limit.title}</dt>
                  <dd className="mt-1 text-[14.5px] text-soft">{limit.body}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 text-[13.5px] text-faint">
              Remove a machine any time from its page in{" "}
              <Link
                href="/devices"
                className="border-b border-line text-ink transition-colors hover:text-signal"
              >
                Devices
              </Link>
              . Revoking takes effect on the agent&rsquo;s next poll, within a few
              seconds.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Run the installer",
    body: "It installs to your user folder and registers DeskWarrant to start when you log in. There is no administrator prompt at any point — the agent is deliberately unelevated, so asking for admin would claim a privilege it never uses.",
  },
  {
    n: "02",
    title: "Approve this PC",
    body: "The agent opens your browser to an approval screen and shows a four-character code. Pick the matching one out of four. A wrong pick denies the request outright, which is what stops a mailed link from enrolling someone else's machine into your account.",
  },
  {
    n: "03",
    title: "That is it",
    body: "The machine appears in Devices as online and reconnects on its own after a reboot. Ask, Act, Watch and Control all work immediately.",
  },
];

const LIMITS = [
  {
    title: "Runs unelevated",
    body: "It cannot reach the lock screen, UAC prompts, or anything needing administrator rights.",
  },
  {
    title: "Folders you choose",
    body: "A fixed allowlist that can only be widened on the PC itself — never from here, never by the assistant.",
  },
  {
    title: "No delete tool",
    body: "It can list folders and open files inside the ones you allow. There is nothing in the catalogue that removes anything.",
  },
  {
    title: "Reachable only while watched",
    body: "The tunnel starts when you open live view and stops seconds after you close it.",
  },
];

function DownloadGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
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

function LockGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
