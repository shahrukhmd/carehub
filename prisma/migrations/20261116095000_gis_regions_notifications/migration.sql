-- CreateTable
CREATE TABLE "GisRegion" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "geojson" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#1f2937',
    "featureCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GisRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GisNotification" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GisNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GisRegion_practiceId_idx" ON "GisRegion"("practiceId");

-- CreateIndex
CREATE INDEX "GisNotification_userId_readAt_idx" ON "GisNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "GisNotification_practiceId_createdAt_idx" ON "GisNotification"("practiceId", "createdAt");

-- AddForeignKey
ALTER TABLE "GisRegion" ADD CONSTRAINT "GisRegion_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisNotification" ADD CONSTRAINT "GisNotification_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisNotification" ADD CONSTRAINT "GisNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

