import { requireUser } from "@/lib/api-auth";
import { handleRoute, json } from "@/lib/http";
import { CLOUDFLARE_STUN, mintTurnCredentials } from "@/lib/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/turn-credentials — per-session, short-lived ICE configuration.
 *
 * Requires a signed-in user so the credential cannot be harvested anonymously.
 */
export async function GET() {
  return handleRoute(async () => {
    await requireUser();

    try {
      const creds = await mintTurnCredentials(600);
      return json(creds);
    } catch (err) {
      console.error("[turn] mint failed", err);
      // STUN-only still connects on the same network; the client surfaces the
      // degraded state rather than hanging on ICE forever.
      return json(
        {
          iceServers: [CLOUDFLARE_STUN],
          ttlSeconds: 600,
          turnConfigured: false,
          warning:
            "TURN credentials unavailable. Live view will only work when both devices are on the same network.",
        },
        { status: 200 },
      );
    }
  });
}
