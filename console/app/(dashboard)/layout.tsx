import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { SidebarLinks, TopBarLinks } from "@/components/ConsoleNav";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const signOutForm = (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="flex w-full items-center gap-3 rounded-full px-3.5 py-2.5 text-left text-[14px] text-soft transition-colors hover:bg-ink/[0.05] hover:text-ink"
      >
        <ExitGlyph />
        Sign out
      </button>
    </form>
  );

  return (
    /*
      Exactly one viewport tall, and it owns the overflow. The `flex-1 min-h-0`
      panes inside it — chat transcript, live canvas, event feed — scroll within
      their own frames instead of stretching the page; given a minimum height
      the chat grows without bound and takes the window scrollbar with it.
    */
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop rail. Below lg it collapses into the top bar. */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-line px-4 py-5 lg:flex">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-3 px-2 text-ink"
          title="Back to the overview"
        >
          <Logo size={34} />
          <span className="font-serif text-[21px] tracking-[-0.01em] leading-none">
            DeskWarrant
          </span>
        </Link>

        <SidebarLinks />

        <div className="mt-auto border-t border-line pt-4">
          <p
            className="truncate px-3.5 pb-3 font-mono text-[11px] text-faint"
            title={session.user.email ?? undefined}
          >
            {session.user.email}
          </p>
          <ThemeToggle
            label
            className="w-full rounded-full px-3.5 py-2.5 hover:bg-ink/[0.05]"
          />
          {signOutForm}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Narrow-screen bar. The wordmark drops to the mark alone so the nav
            and the controls both fit at 360px. */}
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-3 sm:px-4 lg:hidden">
          <Link href="/" className="inline-flex shrink-0 items-center text-ink" title="Overview">
            <Logo size={30} />
          </Link>
          <span className="hidden font-serif text-[19px] leading-none sm:inline">
            DeskWarrant
          </span>

          <div className="mx-auto min-w-0">
            <TopBarLinks />
          </div>

          <ThemeToggle className="shrink-0 p-1.5" />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              aria-label="Sign out"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-soft transition-colors hover:bg-ink/[0.05] hover:text-ink"
            >
              <ExitGlyph />
            </button>
          </form>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

function ExitGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M15 17l5-5-5-5M20 12H9M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
    </svg>
  );
}
