ALTER TABLE "Consent"
  ADD COLUMN "noticeVersion" TEXT NOT NULL DEFAULT 'MWEIN-PRIVACY-1',
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'WRITTEN',
  ADD COLUMN "evidenceReference" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "withdrawnById" UUID,
  ADD COLUMN "withdrawalReason" TEXT;

CREATE INDEX "Consent_patientId_type_recordedAt_idx" ON "Consent"("patientId", "type", "recordedAt");
CREATE INDEX "Consent_patientId_withdrawnAt_expiresAt_idx" ON "Consent"("patientId", "withdrawnAt", "expiresAt");

CREATE TABLE "DataSubjectRequest" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "details" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "denialReason" TEXT,
  "evidenceReference" TEXT,
  "createdById" UUID NOT NULL,
  "updatedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataSubjectRequest_type_check" CHECK ("type" IN ('ACCESS', 'CORRECTION', 'PORTABLE_EXPORT', 'DISCLOSURE')),
  CONSTRAINT "DataSubjectRequest_status_check" CHECK ("status" IN ('RECEIVED', 'IDENTITY_VERIFIED', 'IN_REVIEW', 'COMPLETED', 'DENIED', 'CANCELLED'))
);

CREATE INDEX "DataSubjectRequest_facilityId_status_dueAt_idx" ON "DataSubjectRequest"("facilityId", "status", "dueAt");
CREATE INDEX "DataSubjectRequest_patientId_requestedAt_idx" ON "DataSubjectRequest"("patientId", "requestedAt");

ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
