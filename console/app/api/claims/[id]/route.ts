import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, notFound } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ClaimView {
  id: string;
  hostname: string;
  osVersion: string;
  agentVersion: string;
  sourceIp: string | null;
  status: string;
  /** The shuffled match codes. The correct one is never sent to the browser. */
  choices: string[];
  createdAt: string;
  expiresAt: string;
}

/**
 * GET /api/claims/:id — what the approval screen renders.
 *
 * Any signed-in user may read a claim they hold the id for, because until
 * someone approves it a claim belongs to nobody. That is safe precisely because
 * reading it grants nothing: the correct match code stays server-side, and the
 * claim secret that redeems it never left the PC.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    await requireUser();
    const { id } = await params;

    const claim = await prisma.pairingClaim.findUnique({ where: { id } });
    if (!claim) return notFound("That pairing request no longer exists.");

    let status = claim.status;
    if (status === "PENDING" && claim.expiresAt < new Date()) {
      await prisma.pairingClaim.update({
        where: { id: claim.id },
        data: { status: "EXPIRED" },
      });
      status = "EXPIRED";
    }

    const view: ClaimView = {
      id: claim.id,
      hostname: claim.hostname,
      osVersion: claim.osVersion,
      agentVersion: claim.agentVersion,
      sourceIp: claim.sourceIp,
      status,
      choices: claim.choices,
      createdAt: claim.createdAt.toISOString(),
      expiresAt: claim.expiresAt.toISOString(),
    };

    return json({ claim: view });
  });
}
