CREATE TABLE "PatientIdentityReconciliation" (
  "id" UUID NOT NULL, "facilityId" UUID NOT NULL, "patientId" UUID NOT NULL,
  "previousStatus" TEXT NOT NULL, "resultingStatus" TEXT NOT NULL,
  "evidenceType" TEXT NOT NULL, "evidenceReference" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "reconciledById" UUID NOT NULL, "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientIdentityReconciliation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PatientIdentityReconciliation_facilityId_reconciledAt_idx" ON "PatientIdentityReconciliation"("facilityId", "reconciledAt");
CREATE INDEX "PatientIdentityReconciliation_patientId_reconciledAt_idx" ON "PatientIdentityReconciliation"("patientId", "reconciledAt");
ALTER TABLE "PatientIdentityReconciliation" ADD CONSTRAINT "PatientIdentityReconciliation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientIdentityReconciliation" ADD CONSTRAINT "PatientIdentityReconciliation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientIdentityReconciliation" ADD CONSTRAINT "PatientIdentityReconciliation_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PatientRightsRequest" (
  "id" UUID NOT NULL, "facilityId" UUID NOT NULL, "patientId" UUID NOT NULL,
  "requestNumber" TEXT NOT NULL, "type" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "channel" TEXT NOT NULL, "details" TEXT NOT NULL, "dueAt" TIMESTAMP(3) NOT NULL,
  "assignedToId" UUID, "outcome" TEXT, "evidenceReference" TEXT,
  "createdById" UUID NOT NULL, "resolvedById" UUID, "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientRightsRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PatientRightsRequest_requestNumber_key" ON "PatientRightsRequest"("requestNumber");
CREATE INDEX "PatientRightsRequest_facilityId_status_dueAt_idx" ON "PatientRightsRequest"("facilityId", "status", "dueAt");
CREATE INDEX "PatientRightsRequest_patientId_createdAt_idx" ON "PatientRightsRequest"("patientId", "createdAt");
ALTER TABLE "PatientRightsRequest" ADD CONSTRAINT "PatientRightsRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientRightsRequest" ADD CONSTRAINT "PatientRightsRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientRightsRequest" ADD CONSTRAINT "PatientRightsRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientRightsRequest" ADD CONSTRAINT "PatientRightsRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientRightsRequest" ADD CONSTRAINT "PatientRightsRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ExchangeSubmission" (
  "id" UUID NOT NULL, "facilityId" UUID NOT NULL, "patientId" UUID,
  "channel" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PREPARED',
  "idempotencyKey" TEXT NOT NULL, "profileVersion" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL, "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3), "lastAttemptAt" TIMESTAMP(3),
  "acknowledgementCode" TEXT, "acknowledgement" JSONB, "errorCode" TEXT, "errorMessage" TEXT,
  "createdById" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExchangeSubmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExchangeSubmission_idempotencyKey_key" ON "ExchangeSubmission"("idempotencyKey");
CREATE INDEX "ExchangeSubmission_facilityId_channel_status_createdAt_idx" ON "ExchangeSubmission"("facilityId", "channel", "status", "createdAt");
CREATE INDEX "ExchangeSubmission_facilityId_nextAttemptAt_idx" ON "ExchangeSubmission"("facilityId", "nextAttemptAt");
ALTER TABLE "ExchangeSubmission" ADD CONSTRAINT "ExchangeSubmission_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExchangeSubmission" ADD CONSTRAINT "ExchangeSubmission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExchangeSubmission" ADD CONSTRAINT "ExchangeSubmission_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
