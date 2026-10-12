-- CreateTable
CREATE TABLE "UltramistOrder" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "orderingProviderId" TEXT,
    "orderingPhysician" TEXT,
    "dateOrdered" TIMESTAMP(3),
    "seriesPlan" TEXT,
    "plannedVisits" INTEGER,
    "umStatus" TEXT NOT NULL DEFAULT 'RCM_CHECK_NEEDED',
    "priorAuthStatus" TEXT,
    "priorAuthNumber" TEXT,
    "priorAuthNotes" TEXT,
    "notesOnMedicalNecessity" TEXT,
    "notes" TEXT,
    "unableToSeeReason" TEXT,
    "numberOfMadeUmAppointments" INTEGER NOT NULL DEFAULT 0,
    "umAppointmentsSinceLastProviderVisit" INTEGER NOT NULL DEFAULT 0,
    "dateLastSeenByProvider" TIMESTAMP(3),
    "dateOfNextUm" TIMESTAMP(3),
    "greaterThan18VisitFlag" BOOLEAN NOT NULL DEFAULT false,
    "countsRefreshedAt" TIMESTAMP(3),
    "dateCompleted" TIMESTAMP(3),
    "assignedToId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UltramistOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UltramistOrder_practiceId_umStatus_idx" ON "UltramistOrder"("practiceId", "umStatus");
CREATE INDEX "UltramistOrder_patientId_idx" ON "UltramistOrder"("patientId");
CREATE INDEX "UltramistOrder_dateOfNextUm_idx" ON "UltramistOrder"("dateOfNextUm");

-- AddForeignKey
ALTER TABLE "UltramistOrder" ADD CONSTRAINT "UltramistOrder_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UltramistOrder" ADD CONSTRAINT "UltramistOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UltramistOrder" ADD CONSTRAINT "UltramistOrder_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UltramistOrder" ADD CONSTRAINT "UltramistOrder_orderingProviderId_fkey" FOREIGN KEY ("orderingProviderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UltramistOrder" ADD CONSTRAINT "UltramistOrder_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
