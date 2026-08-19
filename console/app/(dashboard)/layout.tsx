import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    /*
      Exactly one viewport tall, and it owns the overflow. The `flex-1 min-h-0`
      panes inside it — chat transcript, live canvas, event feed — scroll within
      their own frames instead of stretching the page; given a minimum height
      the chat grows without bound and takes the window scrollbar with it.
    */
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 border-b-2 border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link
            href="/devices"
            className="flex items-center gap-2.5 text-foreground"
          >
            <Logo size={22} />
            <span className="font-extrabold tracking-[-0.02em]">
              DeskWarrant
            </span>
          </Link>

          <nav className="ml-4 hidden items-center gap-5 sm:flex">
            <Link
              href="/devices"
              className="text-[13px] uppercase tracking-[0.06em] text-muted transition-colors hover:text-accent"
            >
              Devices
            </Link>
            <Link
              href="/download"
              className="text-[13px] uppercase tracking-[0.06em] text-muted transition-colors hover:text-accent"
            >
              Add a PC
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted md:inline">
              {session.user.email}
            </span>
            <ThemeToggle />
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="border-2 border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted transition-colors hover:border-accent hover:text-accent"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
