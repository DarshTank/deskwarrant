import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

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
 * Requires authentication. Unauthenticated requests are redirected to /signin.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    const url = new URL(req.url);
    return NextResponse.redirect(new URL("/signin?next=/download", url.origin), 302);
  }

  const requested = new URL(req.url).searchParams.get("flavor");
  const flavor: Flavor =
    requested && requested in ASSETS ? (requested as Flavor) : "installer";

  return NextResponse.redirect(
    `https://github.com/${REPO}/releases/latest/download/${ASSETS[flavor]}`,
    302,
  );
}
