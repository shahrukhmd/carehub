-- DropForeignKey
ALTER TABLE "TelehealthProvider" DROP CONSTRAINT "TelehealthProvider_userId_fkey";

-- DropIndex
DROP INDEX "TelehealthProvider_userId_key";

-- AlterTable
ALTER TABLE "TelehealthAvailability" ADD COLUMN     "breakAfterBlocks" INTEGER;

-- AlterTable
ALTER TABLE "TelehealthProvider" DROP COLUMN "breakAfterBlocks",
DROP COLUMN "breakMinWindowMin",
DROP COLUMN "specialty",
DROP COLUMN "suffix",
DROP COLUMN "userId",
ADD COLUMN     "renderingProviderId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TelehealthProvider_renderingProviderId_key" ON "TelehealthProvider"("renderingProviderId");

-- AddForeignKey
ALTER TABLE "TelehealthProvider" ADD CONSTRAINT "TelehealthProvider_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

