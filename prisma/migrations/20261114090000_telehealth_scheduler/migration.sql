-- CreateTable
CREATE TABLE "TelehealthProvider" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "suffix" TEXT NOT NULL DEFAULT 'Dr.',
    "specialty" TEXT,
    "stateLicenses" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "breakAfterBlocks" INTEGER,
    "breakMinWindowMin" INTEGER NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelehealthProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelehealthAvailability" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelehealthAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelehealthReservation" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "availabilityId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "stateCode" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 20,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "notes" TEXT NOT NULL,
    "cancelReason" TEXT,
    "reservedById" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelehealthReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelehealthProvider_userId_key" ON "TelehealthProvider"("userId");

-- CreateIndex
CREATE INDEX "TelehealthAvailability_practiceId_startsAt_idx" ON "TelehealthAvailability"("practiceId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelehealthAvailability_providerId_startsAt_endsAt_key" ON "TelehealthAvailability"("providerId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelehealthReservation_appointmentId_key" ON "TelehealthReservation"("appointmentId");

-- CreateIndex
CREATE INDEX "TelehealthReservation_providerId_startsAt_idx" ON "TelehealthReservation"("providerId", "startsAt");

-- CreateIndex
CREATE INDEX "TelehealthReservation_practiceId_startsAt_idx" ON "TelehealthReservation"("practiceId", "startsAt");

-- AddForeignKey
ALTER TABLE "TelehealthProvider" ADD CONSTRAINT "TelehealthProvider_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelehealthProvider" ADD CONSTRAINT "TelehealthProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelehealthAvailability" ADD CONSTRAINT "TelehealthAvailability_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelehealthAvailability" ADD CONSTRAINT "TelehealthAvailability_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TelehealthProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelehealthReservation" ADD CONSTRAINT "TelehealthReservation_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelehealthReservation" ADD CONSTRAINT "TelehealthReservation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TelehealthProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelehealthReservation" ADD CONSTRAINT "TelehealthReservation_availabilityId_fkey" FOREIGN KEY ("availabilityId") REFERENCES "TelehealthAvailability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelehealthReservation" ADD CONSTRAINT "TelehealthReservation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelehealthReservation" ADD CONSTRAINT "TelehealthReservation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
