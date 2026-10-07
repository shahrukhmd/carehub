-- CreateTable
CREATE TABLE "InterfaceMessage" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "apiClientId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'HL7',
    "messageType" TEXT,
    "controlId" TEXT,
    "sender" TEXT,
    "raw" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "patientHint" TEXT,
    "requisition" TEXT,
    "orderId" TEXT,
    "filedCount" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "ack" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "InterfaceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterfaceMessage_practiceId_status_receivedAt_idx" ON "InterfaceMessage"("practiceId", "status", "receivedAt");

-- AddForeignKey
ALTER TABLE "InterfaceMessage" ADD CONSTRAINT "InterfaceMessage_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

