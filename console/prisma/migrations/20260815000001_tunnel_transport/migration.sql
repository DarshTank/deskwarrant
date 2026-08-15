-- CreateEnum
CREATE TYPE "TunnelState" AS ENUM ('STARTING', 'UP', 'FAILED', 'STOPPED');

-- DropForeignKey
ALTER TABLE "RtcSession" DROP CONSTRAINT "RtcSession_deviceId_fkey";

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "tunnelHostname" TEXT,
ADD COLUMN     "tunnelName" TEXT;

-- DropTable
DROP TABLE "RtcSession";

-- DropEnum
DROP TYPE "RtcStatus";

-- CreateTable
CREATE TABLE "ViewSession" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "tunnelState" "TunnelState" NOT NULL DEFAULT 'STARTING',
    "tunnelError" TEXT,

    CONSTRAINT "ViewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViewSession_deviceId_key" ON "ViewSession"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ViewToken_tokenHash_key" ON "ViewToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ViewToken_deviceId_idx" ON "ViewToken"("deviceId");

-- AddForeignKey
ALTER TABLE "ViewSession" ADD CONSTRAINT "ViewSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewToken" ADD CONSTRAINT "ViewToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ViewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
