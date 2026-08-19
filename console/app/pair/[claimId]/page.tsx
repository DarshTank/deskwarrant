import { redirect } from "next/navigation";
import { PairApproval } from "@/components/PairApproval";
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
    <main className="flex-1 overflow-y-auto px-6 py-12">
      <PairApproval claimId={claimId} />
    </main>
  );
}
