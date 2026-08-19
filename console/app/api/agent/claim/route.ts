import { z } from "zod";
import { prisma } from "@/lib/db";
import { handleRoute, json, parseBody } from "@/lib/http";
import { assertClaimQuota } from "@/lib/rate-limit";
import {
  generateClaimSecret,
  generateMatchCodes,
  hashToken,
} from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLAIM_TTL_MS = 10 * 60 * 1000;
/** Consumed and dead claims are swept opportunistically; there is no cron. */
const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000;

const bodySchema = z.object({
  hostname: z.string().min(1).max(120),
  osVersion: z.string().min(1).max(120),
  agentVersion: z.string().min(1).max(40),
});

/**
 * The client IP as seen through Vercel's proxy; null in local development.
 *
 * `x-real-ip` is preferred because Vercel's edge sets it to the actual client
 * address as a single value. `x-forwarded-for` is a list that can carry a
 * client-supplied prefix, and since this IP is the *only* thing bounding an
 * unauthenticated endpoint, trusting an attacker-controllable first entry would
 * let them rotate rate-limit buckets at will and defeat the cap entirely.
 */
function sourceIp(req: Request): string | null {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real && real.length <= 64) return real;

  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : null;
}

/**
 * POST /api/agent/claim — a PC asks to join an account.
 *
 * Unauthenticated by necessity: the agent has no credential yet, and the whole
 * point is that it does not need a human to carry one to it. What it gets back
 * is worth nothing on its own — a claim confers no access until someone signed
 * into the console approves it, and only the approver's account can be joined.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    const body = await parseBody(req, bodySchema);
    const ip = sourceIp(req);

    await assertClaimQuota(ip);

    // Keep the table from growing without bound. Cheap, indexed, and running
    // it here means it happens exactly when rows are being added.
    await prisma.pairingClaim.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - SWEEP_AFTER_MS) } },
    });

    const claimSecret = generateClaimSecret();
    const { matchCode, choices } = generateMatchCodes();
    const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);

    const claim = await prisma.pairingClaim.create({
      data: {
        secretHash: hashToken(claimSecret),
        hostname: body.hostname,
        osVersion: body.osVersion,
        agentVersion: body.agentVersion,
        matchCode,
        choices,
        sourceIp: ip,
        expiresAt,
      },
    });

    return json({
      claimId: claim.id,
      claimSecret,
      matchCode,
      // A path, not a URL: the agent already knows which console it is talking
      // to, and deriving an absolute origin behind a proxy is a needless way to
      // get the pairing link wrong.
      approvePath: `/pair/${claim.id}`,
      expiresAt: expiresAt.toISOString(),
    });
  });
}
