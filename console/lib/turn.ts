import { env, hasEnv } from "./env";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Free, no-credential STUN. Always offered alongside TURN. */
export const CLOUDFLARE_STUN: IceServer = {
  urls: "stun:stun.cloudflare.com:3478",
};

/**
 * Mint short-lived Cloudflare Realtime TURN credentials.
 *
 * Build plan §7.2/§11: credentials are minted server-side, per session, and are
 * short-lived. A static credential embedded in client code yields zero relay
 * candidates in practice and connections fail silently across NATs — the single
 * most common cause of "works on my Wi-Fi, fails everywhere else".
 */
export async function mintTurnCredentials(ttlSeconds = 600): Promise<{
  iceServers: IceServer[];
  ttlSeconds: number;
  turnConfigured: boolean;
}> {
  if (!hasEnv("CLOUDFLARE_TURN_KEY_ID") || !hasEnv("CLOUDFLARE_TURN_API_TOKEN")) {
    // Degrade to STUN-only rather than failing: same-network live view still
    // works, and the UI can tell the user why remote networks do not.
    return { iceServers: [CLOUDFLARE_STUN], ttlSeconds, turnConfigured: false };
  }

  const endpoint = `https://rtc.live.cloudflare.com/v1/turn/keys/${env.turnKeyId}/credentials/generate-ice-servers`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.turnApiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl: ttlSeconds }),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Cloudflare TURN credential request failed (${res.status}): ${detail.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as {
    iceServers?: IceServer | IceServer[];
  };

  // Cloudflare has shipped both shapes across API versions; normalise.
  const raw = data.iceServers;
  const servers: IceServer[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return {
    iceServers: [CLOUDFLARE_STUN, ...servers],
    ttlSeconds,
    turnConfigured: servers.length > 0,
  };
}
