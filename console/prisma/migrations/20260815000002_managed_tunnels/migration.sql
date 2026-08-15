-- AlterTable
ALTER TABLE "Device" DROP COLUMN "tunnelName",
ADD COLUMN     "tunnelError" TEXT,
ADD COLUMN     "tunnelId" TEXT,
ADD COLUMN     "tunnelTokenEnc" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Device_tunnelId_key" ON "Device"("tunnelId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tunnelHostname_key" ON "Device"("tunnelHostname");
