-- CreateTable
CREATE TABLE "GisMap" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mapType" TEXT NOT NULL DEFAULT 'PROVIDER',
    "providerId" TEXT,
    "maskId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION,
    "centerLng" DOUBLE PRECISION,
    "zoom" DOUBLE PRECISION,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GisMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GisMapMember" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GisMapMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GisMapPinStyle" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GisMapPinStyle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GisRoute" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "markerColor" TEXT NOT NULL DEFAULT '#2563eb',
    "layerColor" TEXT NOT NULL DEFAULT '#dbeafe',
    "layerTextColor" TEXT NOT NULL DEFAULT '#1e3a8a',
    "optimize" BOOLEAN NOT NULL DEFAULT false,
    "directions" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GisRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GisRouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GisRouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GisMap_maskId_key" ON "GisMap"("maskId");

-- CreateIndex
CREATE INDEX "GisMap_practiceId_idx" ON "GisMap"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "GisMapMember_mapId_userId_key" ON "GisMapMember"("mapId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GisMapPinStyle_mapId_patientId_key" ON "GisMapPinStyle"("mapId", "patientId");

-- CreateIndex
CREATE INDEX "GisRoute_mapId_visitDate_idx" ON "GisRoute"("mapId", "visitDate");

-- CreateIndex
CREATE INDEX "GisRouteStop_routeId_index_idx" ON "GisRouteStop"("routeId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "GisRouteStop_routeId_patientId_key" ON "GisRouteStop"("routeId", "patientId");

-- AddForeignKey
ALTER TABLE "GisMap" ADD CONSTRAINT "GisMap_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisMap" ADD CONSTRAINT "GisMap_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisMapMember" ADD CONSTRAINT "GisMapMember_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GisMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisMapMember" ADD CONSTRAINT "GisMapMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisMapPinStyle" ADD CONSTRAINT "GisMapPinStyle_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GisMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisMapPinStyle" ADD CONSTRAINT "GisMapPinStyle_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisRoute" ADD CONSTRAINT "GisRoute_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GisMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisRouteStop" ADD CONSTRAINT "GisRouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "GisRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisRouteStop" ADD CONSTRAINT "GisRouteStop_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

