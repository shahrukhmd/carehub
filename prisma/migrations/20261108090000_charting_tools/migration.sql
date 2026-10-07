-- CreateTable
CREATE TABLE "TextMacro" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT,
    "shortcut" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT 'UNIVERSAL',
    "text" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextMacro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationResource" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "summary" TEXT,
    "source" TEXT NOT NULL DEFAULT 'Provider',
    "language" TEXT NOT NULL DEFAULT 'en',
    "forCode" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EducationResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TextMacro_practiceId_userId_shortcut_idx" ON "TextMacro"("practiceId", "userId", "shortcut");

-- CreateIndex
CREATE INDEX "EducationResource_encounterId_idx" ON "EducationResource"("encounterId");

-- AddForeignKey
ALTER TABLE "TextMacro" ADD CONSTRAINT "TextMacro_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextMacro" ADD CONSTRAINT "TextMacro_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationResource" ADD CONSTRAINT "EducationResource_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationResource" ADD CONSTRAINT "EducationResource_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationResource" ADD CONSTRAINT "EducationResource_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

