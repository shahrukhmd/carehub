-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "geocodeError" TEXT,
ADD COLUMN     "geocodeSource" TEXT,
ADD COLUMN     "geocodedAt" TIMESTAMP(3),
ADD COLUMN     "gisNextVisit" TIMESTAMP(3),
ADD COLUMN     "gisNote" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "lpnProviderId" TEXT,
ADD COLUMN     "maProviderId" TEXT,
ADD COLUMN     "npProviderId" TEXT,
ADD COLUMN     "weeklySchedule" TEXT;

-- AlterTable
ALTER TABLE "RenderingProvider" ADD COLUMN     "geocodeError" TEXT,
ADD COLUMN     "geocodedAt" TIMESTAMP(3),
ADD COLUMN     "gisActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gisTitle" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_npProviderId_fkey" FOREIGN KEY ("npProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_lpnProviderId_fkey" FOREIGN KEY ("lpnProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_maProviderId_fkey" FOREIGN KEY ("maProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

