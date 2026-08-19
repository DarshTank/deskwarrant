-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CONSUMED');

-- CreateTable
CREATE TABLE "PairingClaim" (
    "id" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "matchCode" TEXT NOT NULL,
    "choices" TEXT[],
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "sourceIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "PairingClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PairingClaim_secretHash_key" ON "PairingClaim"("secretHash");

-- CreateIndex
CREATE INDEX "PairingClaim_status_expiresAt_idx" ON "PairingClaim"("status", "expiresAt");
