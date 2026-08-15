import { randomBytes } from "node:crypto";
import { env, hasEnv } from "./env";

/**
 * Cloudflare Tunnel provisioning.
 *
 * Every paired PC gets its own tunnel and its own subdomain, created here
 * through the Cloudflare API. The user never installs cloudflared by hand,
 * never runs `cloudflared tunnel login`, and never needs a Cloudflare account
 * or a domain of their own.
 *
 * The security trade this rests on: the API token — which can edit DNS across
 * the whole zone — lives ONLY here, server-side. What each PC receives is a
 * *tunnel token*, scoped to that one tunnel. A stolen tunnel token lets an
 * attacker run that single tunnel; it cannot touch DNS or any other device.
 *
 * Tunnels are created with `config_src: "cloudflare"` (remotely-managed), so
 * ingress rules live in Cloudflare rather than in a config.yml on the PC.
 * That is what lets the agent run with nothing but `--token`.
 */

const API_BASE = "https://api.cloudflare.com/client/v4";

/** The agent's loopback server port. Ingress is written against this. */
export const VIEW_LOCAL_PORT = 47_821;

export class CloudflareError extends Error {}

export interface ProvisionedTunnel {
  tunnelId: string;
  hostname: string;
  /** Plaintext. Encrypt before storing. */
  token: string;
}

/** True when tunnel provisioning is configured. Live view is optional without it. */
export function isTunnelProvisioningEnabled(): boolean {
  return (
    hasEnv("CLOUDFLARE_API_TOKEN") &&
    hasEnv("CLOUDFLARE_ACCOUNT_ID") &&
    hasEnv("CLOUDFLARE_ZONE_ID") &&
    hasEnv("TUNNEL_BASE_DOMAIN")
  );
}

interface CloudflareResponse<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
}

async function callApi<T>(
  path: string,
  init: RequestInit & { method: string },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.cloudflareApiToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (err) {
    throw new CloudflareError(
      `Could not reach the Cloudflare API: ${(err as Error).message}`,
    );
  }

  const text = await response.text();
  let body: CloudflareResponse<T> | null = null;
  try {
    body = JSON.parse(text) as CloudflareResponse<T>;
  } catch {
    /* fall through to the status-based error below */
  }

  if (!response.ok || !body?.success) {
    const detail =
      body?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ??
      text.slice(0, 200);
    throw new CloudflareError(
      `Cloudflare API ${init.method} ${path} failed (${response.status}): ${detail}`,
    );
  }

  return body.result;
}

/** `pc-` plus 8 hex chars. Random so hostnames are not enumerable. */
function generateHostLabel(): string {
  return `pc-${randomBytes(4).toString("hex")}`;
}

/**
 * Create a tunnel, point it at the agent's local port, and give it a hostname.
 *
 * Rolls back on partial failure: a tunnel with no DNS record is invisible
 * clutter in the account, and a DNS record with no tunnel is a hostname that
 * resolves to nothing.
 */
export async function provisionTunnel(
  deviceId: string,
): Promise<ProvisionedTunnel> {
  const accountId = env.cloudflareAccountId;
  const label = generateHostLabel();
  const hostname = `${label}.${env.tunnelBaseDomain}`;

  const tunnel = await callApi<{ id: string }>(
    `/accounts/${accountId}/cfd_tunnel`,
    {
      method: "POST",
      body: JSON.stringify({
        name: `deskwarrant-${deviceId}`,
        // Remotely-managed: ingress comes from the API call below, so the PC
        // needs no config.yml and no credentials file.
        config_src: "cloudflare",
      }),
    },
  );

  try {
    await callApi(
      `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`,
      {
        method: "PUT",
        body: JSON.stringify({
          config: {
            ingress: [
              { hostname, service: `http://127.0.0.1:${VIEW_LOCAL_PORT}` },
              // Catch-all: required by cloudflared, and must be last.
              { service: "http_status:404" },
            ],
          },
        }),
      },
    );

    await callApi(`/zones/${env.cloudflareZoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: "CNAME",
        name: label,
        content: `${tunnel.id}.cfargotunnel.com`,
        proxied: true,
        comment: `DeskWarrant device ${deviceId}`,
      }),
    });

    const { token } = await callApi<{ token: string }>(
      `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/token`,
      { method: "GET" },
    );

    return { tunnelId: tunnel.id, hostname, token };
  } catch (err) {
    // Never leave a half-provisioned tunnel behind.
    await deleteTunnel(tunnel.id).catch(() => {});
    throw err;
  }
}

/** Delete the tunnel. Called when a device is revoked. */
export async function deleteTunnel(tunnelId: string): Promise<void> {
  await callApi(`/accounts/${env.cloudflareAccountId}/cfd_tunnel/${tunnelId}`, {
    method: "DELETE",
  });
}

/** Delete the hostname's DNS record, so it stops resolving entirely. */
export async function deleteDnsRecord(hostname: string): Promise<void> {
  const records = await callApi<{ id: string }[]>(
    `/zones/${env.cloudflareZoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
    { method: "GET" },
  );
  for (const record of records) {
    await callApi(`/zones/${env.cloudflareZoneId}/dns_records/${record.id}`, {
      method: "DELETE",
    });
  }
}

/**
 * Tear down everything provisioned for a device. Best effort and never throws:
 * revoking a device must succeed even if Cloudflare is unreachable, or the
 * user is left unable to remove their own PC.
 */
export async function deprovisionTunnel(opts: {
  tunnelId?: string | null;
  hostname?: string | null;
}): Promise<void> {
  if (opts.hostname) {
    await deleteDnsRecord(opts.hostname).catch((err) =>
      console.error("[cloudflare] DNS record cleanup failed", err),
    );
  }
  if (opts.tunnelId) {
    await deleteTunnel(opts.tunnelId).catch((err) =>
      console.error("[cloudflare] tunnel cleanup failed", err),
    );
  }
}
