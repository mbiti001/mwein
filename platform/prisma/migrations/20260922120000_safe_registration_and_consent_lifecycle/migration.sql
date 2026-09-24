ALTER TABLE "Patient"
  ADD COLUMN "registrationMode" TEXT NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "identityStatus" TEXT NOT NULL DEFAULT 'ASSERTED';

ALTER TABLE "Consent"
  ADD COLUMN "noticeVersion" TEXT,
  ADD COLUMN "lawfulBasis" TEXT,
  ADD COLUMN "representativeName" TEXT,
  ADD COLUMN "representativeRelationship" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "withdrawnById" UUID;

CREATE INDEX "Consent_patientId_type_recordedAt_idx"
  ON "Consent"("patientId", "type", "recordedAt");
