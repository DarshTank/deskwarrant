import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, notFound } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/claims/:id/deny — refuse a pairing request. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    await requireUser();
    const { id } = await params;

    const claim = await prisma.pairingClaim.findUnique({ where: { id } });
    if (!claim) return notFound("That pairing request no longer exists.");

    // Only a claim nobody has acted on can be denied; an already-approved one
    // has a device behind it and is revoked from the devices page instead.
    await prisma.pairingClaim.updateMany({
      where: { id: claim.id, status: "PENDING" },
      data: { status: "DENIED" },
    });

    return json({ ok: true });
  });
}
