-- CreateTable
CREATE TABLE "GisSettings" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "googleMapsKey" TEXT,
    "nameFormat" TEXT NOT NULL DEFAULT 'FORMAL',
    "shareLinkDays" INTEGER NOT NULL DEFAULT 14,
    "shareLinkMaxOpens" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GisSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GisSettings_practiceId_key" ON "GisSettings"("practiceId");

-- AddForeignKey
ALTER TABLE "GisSettings" ADD CONSTRAINT "GisSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

