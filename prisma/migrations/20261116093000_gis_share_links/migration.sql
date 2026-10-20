-- CreateTable
CREATE TABLE "GisShareLink" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "routeIds" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxAccess" INTEGER NOT NULL DEFAULT 100,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GisShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GisShareLink_codeHash_key" ON "GisShareLink"("codeHash");

-- CreateIndex
CREATE INDEX "GisShareLink_practiceId_createdAt_idx" ON "GisShareLink"("practiceId", "createdAt");

-- CreateIndex
CREATE INDEX "GisShareLink_mapId_idx" ON "GisShareLink"("mapId");

-- AddForeignKey
ALTER TABLE "GisShareLink" ADD CONSTRAINT "GisShareLink_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisShareLink" ADD CONSTRAINT "GisShareLink_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GisMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

