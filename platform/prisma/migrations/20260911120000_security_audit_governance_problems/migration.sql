ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

CREATE TABLE "LoginThrottle" (
  "key" TEXT NOT NULL,
  "facilityId" UUID,
  "emailHash" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "LoginThrottle_facilityId_updatedAt_idx" ON "LoginThrottle"("facilityId", "updatedAt");
ALTER TABLE "LoginThrottle" ADD CONSTRAINT "LoginThrottle_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD COLUMN "facilityId" UUID,
  ADD COLUMN "chainVersion" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "sequence" BIGINT;

UPDATE "AuditEvent" AS event
SET "facilityId" = actor."facilityId", "chainVersion" = 1
FROM "User" AS actor
WHERE event."userId" = actor."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AuditEvent" WHERE "facilityId" IS NULL) THEN
    RAISE EXCEPTION 'Existing audit events without a resolvable facility must be assigned before migration';
  END IF;
END;
$$;

ALTER TABLE "AuditEvent" ALTER COLUMN "facilityId" SET NOT NULL;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_chain_position"
  CHECK (("chainVersion" = 1 AND "sequence" IS NULL) OR ("chainVersion" >= 2 AND "sequence" > 0));
CREATE UNIQUE INDEX "AuditEvent_facilityId_chainVersion_sequence_key"
  ON "AuditEvent"("facilityId", "chainVersion", "sequence");
CREATE INDEX "AuditEvent_facilityId_occurredAt_idx" ON "AuditEvent"("facilityId", "occurredAt");

CREATE TABLE "AuditChainHead" (
  "facilityId" UUID NOT NULL,
  "chainVersion" INTEGER NOT NULL DEFAULT 2,
  "sequence" BIGINT NOT NULL DEFAULT 0,
  "eventHash" TEXT NOT NULL DEFAULT 'GENESIS',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuditChainHead_pkey" PRIMARY KEY ("facilityId"),
  CONSTRAINT "AuditChainHead_sequence" CHECK ("sequence" >= 0)
);
ALTER TABLE "AuditChainHead" ADD CONSTRAINT "AuditChainHead_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PatientProblem" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "codeSystem" TEXT NOT NULL DEFAULT 'ICD-11 MMS',
  "code" TEXT,
  "foundationUri" TEXT,
  "description" TEXT NOT NULL,
  "clinicalStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "onsetDate" DATE,
  "resolvedAt" TIMESTAMP(3),
  "notes" TEXT,
  "recordedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientProblem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientProblem_clinicalStatus" CHECK ("clinicalStatus" IN ('ACTIVE', 'INACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR'))
);
CREATE INDEX "PatientProblem_facilityId_patientId_clinicalStatus_idx" ON "PatientProblem"("facilityId", "patientId", "clinicalStatus");
CREATE INDEX "PatientProblem_patientId_updatedAt_idx" ON "PatientProblem"("patientId", "updatedAt");
ALTER TABLE "PatientProblem" ADD CONSTRAINT "PatientProblem_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientProblem" ADD CONSTRAINT "PatientProblem_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientProblem" ADD CONSTRAINT "PatientProblem_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "GovernanceEvidence" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "gateCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "owner" TEXT NOT NULL,
  "evidenceReference" TEXT,
  "notes" TEXT,
  "approvedAt" TIMESTAMP(3),
  "reviewDueAt" TIMESTAMP(3),
  "updatedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GovernanceEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GovernanceEvidence_status" CHECK ("status" IN ('PENDING', 'BLOCKED', 'APPROVED', 'EXPIRED'))
);
CREATE UNIQUE INDEX "GovernanceEvidence_facilityId_gateCode_key" ON "GovernanceEvidence"("facilityId", "gateCode");
CREATE INDEX "GovernanceEvidence_facilityId_status_reviewDueAt_idx" ON "GovernanceEvidence"("facilityId", "status", "reviewDueAt");
ALTER TABLE "GovernanceEvidence" ADD CONSTRAINT "GovernanceEvidence_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GovernanceEvidence" ADD CONSTRAINT "GovernanceEvidence_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_immutable"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
