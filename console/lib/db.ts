import { PrismaClient } from "@prisma/client";

// Vercel serverless invocations reuse the module scope between requests, so a
// module-level singleton avoids exhausting Neon's connection pool. DATABASE_URL
// must point at the *pooled* endpoint for this to hold under load.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
