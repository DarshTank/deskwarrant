import { PrismaClient } from "@prisma/client";

// Vercel serverless invocations reuse the module scope between requests, so a
// module-level singleton avoids exhausting Supabase's connection pool.
// DATABASE_URL must point at the Supavisor *transaction* pooler (port 6543) for
// this to hold under load, and must carry `pgbouncer=true` — transaction mode
// cannot keep prepared statements alive across pooled connections, and without
// the flag Prisma's cached statements surface as intermittent
// "prepared statement already exists" errors rather than a clean failure.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Warn — loudly, once per cold start — when DATABASE_URL is pointed somewhere
 * that will work in testing and fail under load.
 *
 * Both mistakes below produce *intermittent* faults that only appear once two
 * requests overlap, which is exactly when they are hardest to read. Surfacing
 * them at import time turns a confusing production symptom into a line in the
 * first log of the deploy.
 *
 * This warns rather than throws on purpose: `next build` imports this module,
 * and a build machine legitimately may not hold the production credentials.
 */
function checkDatabaseUrl(url: string | undefined): void {
  if (!url) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return; // Malformed URLs are Prisma's error to report, with better context.
  }

  // Supavisor's session port speaks one backend connection per client. Every
  // concurrent serverless invocation would hold its own, so the pool runs out
  // under precisely the traffic the pooler was adopted to survive.
  if (parsed.port === "5432" && parsed.hostname.includes("pooler.supabase.com")) {
    console.warn(
      "[db] DATABASE_URL uses the session pooler (:5432). Runtime queries " +
        "should use the transaction pooler (:6543); :5432 belongs in DIRECT_URL.",
    );
  }

  // Transaction mode cannot carry prepared statements between pooled
  // connections. Prisma creates them by default, so without this flag a second
  // concurrent request can land on a connection that already has `s0` bound.
  if (parsed.port === "6543" && parsed.searchParams.get("pgbouncer") !== "true") {
    console.warn(
      "[db] DATABASE_URL targets the transaction pooler (:6543) without " +
        "`pgbouncer=true`. Expect intermittent " +
        '\'prepared statement "s0" already exists\' errors under concurrency.',
    );
  }

  // `connection_limit=1` is the classic serverless recipe, and on Vercel's
  // Fluid compute it is a self-inflicted outage. Fluid runs many concurrent
  // invocations inside ONE Node process, which shares the singleton below, so a
  // pool of one serialises every request that instance is handling. Once the
  // queue outlasts `pool_timeout` (10s by default), requests fail with P2024
  // while the database itself is perfectly healthy.
  if (parsed.searchParams.get("connection_limit") === "1") {
    console.warn(
      "[db] DATABASE_URL sets `connection_limit=1`. Vercel Fluid compute " +
        "multiplexes concurrent requests through this one process, so a pool " +
        "of 1 serialises them and the overflow fails with P2024. Prefer 5-10.",
    );
  }
}

checkDatabaseUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
