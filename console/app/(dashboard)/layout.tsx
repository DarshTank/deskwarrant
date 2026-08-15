import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/devices" className="flex items-center gap-2">
            <ShieldMark />
            <span className="font-semibold tracking-tight">DeskWarrant</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-muted sm:inline">
              {session.user.email}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button
                type="submit"
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0 flex flex-col">{children}</main>
    </div>
  );
}

function ShieldMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
