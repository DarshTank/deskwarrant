import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, json, notFound } from "@/lib/http";
import { assertDeviceQuota } from "@/lib/rate-limit";
import { normalizePairingCode } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  matchCode: z.string().min(1).max(16),
});

/**
 * POST /api/claims/:id/approve — join this PC to the signed-in account.
 *
 * The match code is the anti-phishing step. Someone who was sent a stranger's
 * claim link has no PC in front of them showing a code, so they cannot answer;
 * a wrong pick denies the claim outright rather than allowing another guess,
 * which is what keeps a 1-in-4 choice from degrading into a 4-guess brute
 * force. The honest failure mode this leaves is a user who guesses anyway, and
 * the card they are guessing on shows a hostname they do not recognise.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;

    let body: { matchCode: string };
    try {
      body = bodySchema.parse(await req.json());
    } catch {
      return badRequest("Pick the code shown on the PC.");
    }

    const claim = await prisma.pairingClaim.findUnique({ where: { id } });
    if (!claim) return notFound("That pairing request no longer exists.");

    if (claim.status !== "PENDING") {
      return badRequest("That pairing request has already been answered.");
    }
    if (claim.expiresAt < new Date()) {
      await prisma.pairingClaim.update({
        where: { id: claim.id },
        data: { status: "EXPIRED" },
      });
      return badRequest("That pairing request expired. Restart the agent.");
    }

    if (normalizePairingCode(body.matchCode) !== claim.matchCode) {
      await prisma.pairingClaim.update({
        where: { id: claim.id },
        data: { status: "DENIED" },
      });
      return badRequest(
        "That is not the code shown on the PC, so the request was denied. If you did not start this, nothing further is needed.",
      );
    }

    // Checked here rather than at redeem: this is the moment a person is
    // present to read the message and revoke another PC.
    await assertDeviceQuota(user.id);

    // Guarded on PENDING so two tabs racing cannot both approve.
    const approved = await prisma.pairingClaim.updateMany({
      where: { id: claim.id, status: "PENDING" },
      data: { status: "APPROVED", userId: user.id, approvedAt: new Date() },
    });
    if (approved.count === 0) {
      return badRequest("That pairing request has already been answered.");
    }

    return json({ ok: true });
  });
}
