import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Sign in · DeskWarrant" };

/**
 * The only destination sign-in ever needs to preserve is a pairing approval, so
 * `next` is matched against that exact shape rather than filtered for things
 * that look dangerous.
 *
 * An allowlist is the difference between safe and nearly safe here. Checking
 * "starts with / but not //" reads airtight and is not: browsers normalise
 * backslashes to forward slashes, so `/\evil.com` becomes `//evil.com` and
 * redirects off-site. Anchoring the whole string leaves no room for a scheme,
 * a host, or an encoding trick.
 */
const NEXT_PATTERN = /^\/pair\/[A-Za-z0-9_-]{1,64}$/;

function safeNext(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "/devices";
  return NEXT_PATTERN.test(value) ? value : "/devices";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const next = safeNext((await searchParams).next);

  const session = await auth();
  if (session?.user) redirect(next);

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-16">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-10 flex items-center gap-3">
          <Logo size={30} />
          <span className="text-[18px] font-extrabold tracking-[-0.02em]">
            DeskWarrant
          </span>
        </Link>

        <p className="kicker">Sign in</p>
        <h1
          className="mt-4 font-extrabold"
          style={{
            fontSize: "clamp(32px, 5vw, 44px)",
            lineHeight: 1.06,
            letterSpacing: "-0.03em",
            marginLeft: "-0.04em",
          }}
        >
          Your PC, on a leash.
        </h1>
        <p className="mt-4 text-[16px] leading-[1.6] text-muted">
          Ask, act, watch and control your Windows PC from any browser.
        </p>

        <div className="mt-8 border-2 border-border bg-surface p-6">
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: next });
            }}
          >
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-3 border-2 border-accent bg-accent px-4 py-3 text-[15px] font-extrabold text-accent-fg transition-opacity hover:opacity-90"
            >
              <GoogleMark />
              Continue with Google
            </button>
          </form>
          <p className="mt-5 border-t border-hairline pt-4 text-[13px] leading-[1.55] text-muted">
            A device belongs to exactly one account. There is no sharing model,
            and that check is the whole authorization layer.
          </p>
        </div>

        <Link
          href="/"
          className="mt-6 inline-block text-[13px] uppercase tracking-[0.06em] text-muted transition-colors hover:text-accent"
        >
          ← Back to the overview
        </Link>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 40.2 44 35 44 24c0-1.3-.1-2.6-.4-3.9z"
      />
    </svg>
  );
}
