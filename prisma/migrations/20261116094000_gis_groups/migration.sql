-- CreateTable
CREATE TABLE "GisGroup" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "icon" TEXT NOT NULL DEFAULT 'USERS',
    "groupType" TEXT NOT NULL DEFAULT 'PATIENT',
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "sortBy" TEXT NOT NULL DEFAULT 'name',
    "showAge" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GisGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GisGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "visibleOnMap" BOOLEAN NOT NULL DEFAULT true,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GisGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GisGroupPatient" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GisGroupPatient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GisGroupProvider" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "renderingProviderId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GisGroupProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GisGroup_practiceId_idx" ON "GisGroup"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "GisGroupMember_groupId_userId_key" ON "GisGroupMember"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GisGroupPatient_groupId_patientId_key" ON "GisGroupPatient"("groupId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "GisGroupProvider_groupId_renderingProviderId_key" ON "GisGroupProvider"("groupId", "renderingProviderId");

-- AddForeignKey
ALTER TABLE "GisGroup" ADD CONSTRAINT "GisGroup_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisGroupMember" ADD CONSTRAINT "GisGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GisGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisGroupMember" ADD CONSTRAINT "GisGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisGroupPatient" ADD CONSTRAINT "GisGroupPatient_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GisGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisGroupPatient" ADD CONSTRAINT "GisGroupPatient_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisGroupProvider" ADD CONSTRAINT "GisGroupProvider_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GisGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GisGroupProvider" ADD CONSTRAINT "GisGroupProvider_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

