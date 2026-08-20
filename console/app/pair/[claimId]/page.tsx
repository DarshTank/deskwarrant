import { redirect } from "next/navigation";
import { PairApproval } from "@/components/PairApproval";
import { ThemeToggle } from "@/components/ThemeToggle";
import { auth } from "@/lib/auth";

export const metadata = { title: "Pair a PC · DeskWarrant" };

/**
 * The page the agent sends you to.
 *
 * Deliberately outside the (dashboard) group: a layout cannot see the path it
 * is wrapping, so sign-in from there would bounce you to /devices and lose the
 * claim. Checking here means the round trip through Google comes back to this
 * exact request.
 */
export default async function PairPage({
  params,
}: {
  params: Promise<{ claimId: string }>;
}) {
  const { claimId } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect(`/signin?next=${encodeURIComponent(`/pair/${claimId}`)}`);
  }

  return (
    <main className="relative min-h-dvh overflow-hidden px-[clamp(20px,5vw,48px)] py-10 sm:py-16">
      <div className="absolute top-6 right-[clamp(20px,5vw,48px)]">
        <ThemeToggle className="p-1.5" />
      </div>
      <PairApproval claimId={claimId} />
    </main>
  );
}
