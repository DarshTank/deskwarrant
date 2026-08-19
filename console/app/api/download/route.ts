import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the release workflow publishes. GitHub resolves `/latest/` itself, so
 * shipping a new version never requires touching the console.
 */
const REPO = process.env.AGENT_REPO ?? "DarshTank/deskwarrant";

const ASSETS = {
  installer: "DeskWarrantSetup.exe",
  portable: "DeskWarrantAgent.exe",
  checksums: "SHA256SUMS.txt",
} as const;

type Flavor = keyof typeof ASSETS;

/**
 * GET /api/download — redirect to the newest agent build.
 *
 * A redirect, not a proxy. The binary is ~60 MB and serverless functions cap
 * response bodies far below that; this way GitHub serves the bytes and the
 * console serves a few hundred of them. Release assets on a public repo need no
 * authentication, so an anonymous browser can follow it.
 */
export async function GET(req: Request) {
  const requested = new URL(req.url).searchParams.get("flavor");
  const flavor: Flavor =
    requested && requested in ASSETS ? (requested as Flavor) : "installer";

  return NextResponse.redirect(
    `https://github.com/${REPO}/releases/latest/download/${ASSETS[flavor]}`,
    302,
  );
}
