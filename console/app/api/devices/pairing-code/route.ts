import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json } from "@/lib/http";
import { generatePairingCode } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** POST /api/devices/pairing-code → { code, expiresAt } */
export async function POST() {
  return handleRoute(async () => {
    const user = await requireUser();

    // Invalidate this user's outstanding codes so only the newest one works.
    await prisma.pairingCode.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    // The alphabet is 32^6 ≈ 1.07e9, so a collision is remote; retry anyway
    // rather than surfacing a unique-constraint error to the user.
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const code = generatePairingCode();
      try {
        await prisma.pairingCode.create({
          data: { userId: user.id, code, expiresAt },
        });
        return json({ code, expiresAt: expiresAt.toISOString() });
      } catch {
        // Collision — try another code.
      }
    }

    return json({ error: "Could not allocate a pairing code." }, { status: 500 });
  });
}
