-- AlterTable
ALTER TABLE "EncounterDocument" ADD COLUMN     "fieldsSnapshot" TEXT;

-- AlterTable
ALTER TABLE "IntakeRequest" ADD COLUMN     "formSnapshots" TEXT NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "SuperbillTemplateItem" ADD COLUMN     "category" TEXT;

-- CreateTable
CREATE TABLE "DocumentRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "fields" TEXT NOT NULL DEFAULT '[]',
    "data" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "savedById" TEXT,
    "savedByName" TEXT,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingPhrase" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normal" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingPhrase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentRevision_documentId_savedAt_idx" ON "DocumentRevision"("documentId", "savedAt");

-- CreateIndex
CREATE INDEX "DocumentRevision_encounterId_idx" ON "DocumentRevision"("encounterId");

-- CreateIndex
CREATE INDEX "FindingPhrase_practiceId_kind_system_idx" ON "FindingPhrase"("practiceId", "kind", "system");

-- AddForeignKey
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EncounterDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingPhrase" ADD CONSTRAINT "FindingPhrase_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

