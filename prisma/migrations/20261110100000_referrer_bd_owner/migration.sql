-- AlterTable
ALTER TABLE "RenderingProvider" ADD COLUMN     "bdOwnerId" TEXT;

-- AddForeignKey
ALTER TABLE "RenderingProvider" ADD CONSTRAINT "RenderingProvider_bdOwnerId_fkey" FOREIGN KEY ("bdOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

