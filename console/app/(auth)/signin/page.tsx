import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

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
  const pairing = next !== "/devices";

  const session = await auth();
  if (session?.user) redirect(next);

  return (
    /*
      Two panels on a wide screen, one column on a narrow one. The left panel
      is the only place in the product that repeats the landing page's voice —
      it is still the front door, and dropping someone straight into a bare
      form loses the thread between the page they clicked from and this one.
    */
    <main className="grid min-h-dvh content-start lg:grid-cols-[1.05fr_1fr] lg:content-stretch">
      <section className="relative flex flex-col gap-10 overflow-hidden border-line px-[clamp(24px,6vw,72px)] py-8 lg:justify-between lg:gap-0 lg:border-r lg:py-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-[30vmax] -left-[20vmax] h-[70vmax] w-[70vmax] rounded-full blur-[18px]"
          style={{
            background:
              "radial-gradient(circle, var(--wash) 0%, transparent 62%)",
          }}
        />

        <div className="relative flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-3 text-ink">
            <Logo size={38} />
            <span className="font-serif text-[23px] tracking-[-0.01em] leading-none">
              DeskWarrant
            </span>
          </Link>
          <ThemeToggle className="p-1.5 lg:hidden" />
        </div>

        <div className="relative lg:py-0">
          <p className="eyebrow mb-5">
            {pairing ? "One machine is asking to join" : "Sign in"}
          </p>
          <h1 className="max-w-[16ch] font-serif text-[clamp(38px,6vw,68px)] leading-[0.98] tracking-[-0.032em]">
            Your PC, on a leash.{" "}
            <span className="text-soft italic">From anywhere.</span>
          </h1>
          <p className="mt-7 max-w-[42ch] text-[clamp(16px,1.6vw,18px)] text-soft">
            {pairing
              ? "Sign in to see the request. You will be shown four codes and asked to pick the one your PC is displaying."
              : "Ask it a question, tell it what to do, have it watch for what you are waiting on — and take the mouse when you want to."}
          </p>
        </div>

        <ul className="relative hidden gap-x-10 gap-y-4 text-[14.5px] text-soft sm:grid sm:grid-cols-2 lg:max-w-[46ch]">
          <li className="border-t border-line pt-3">
            No screenshot ever reaches a model
          </li>
          <li className="border-t border-line pt-3">
            Thirteen typed tools, never a shell
          </li>
          <li className="border-t border-line pt-3">
            One machine, one owner, revocable
          </li>
          <li className="border-t border-line pt-3">
            Free tier, no card, no admin rights
          </li>
        </ul>
      </section>

      <section className="flex items-center justify-center px-[clamp(24px,6vw,72px)] pt-2 pb-14 lg:py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 hidden justify-end lg:flex">
            <ThemeToggle label className="text-[14px]" />
          </div>

          <h2 className="font-serif text-[30px] leading-tight tracking-[-0.02em]">
            Continue
          </h2>
          <p className="mt-2 text-[15px] text-soft">
            One account holds your machines. There is no sharing model.
          </p>

          <form
            className="mt-8"
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: next });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-full bg-ink px-6 py-3.5 text-[15px] font-medium text-paper transition-[transform,opacity] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:opacity-90"
            >
              <GoogleMark />
              Continue with Google
            </button>
          </form>

          <p className="mt-6 border-t border-line pt-5 text-[13.5px] leading-relaxed text-faint">
            Every device-scoped request checks that the machine belongs to you.
            That check is the entire authorization layer — which is why there is
            nothing to configure here.
          </p>

          <Link
            href="/"
            className="mt-8 inline-block text-[14px] text-soft transition-colors hover:text-ink"
          >
            ← Back to the overview
          </Link>
        </div>
      </section>
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
