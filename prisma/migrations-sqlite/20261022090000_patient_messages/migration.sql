-- CreateTable
CREATE TABLE "PatientMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorRole" TEXT,
    "toTeam" TEXT,
    "body" TEXT NOT NULL,
    "needsReply" BOOLEAN NOT NULL DEFAULT false,
    "answeredAt" DATETIME,
    "answeredById" TEXT,
    "replyToId" TEXT,
    "link" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientMessage_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientMessage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PatientMessage_practiceId_patientId_createdAt_idx" ON "PatientMessage"("practiceId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientMessage_practiceId_toTeam_needsReply_answeredAt_idx" ON "PatientMessage"("practiceId", "toTeam", "needsReply", "answeredAt");

