ALTER TABLE "Payment" ADD COLUMN "receivedById" UUID;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Payment_receivedById_receivedAt_idx" ON "Payment"("receivedById", "receivedAt");

CREATE TABLE "ServicePointControl" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "servicePoint" TEXT NOT NULL,
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "pauseReason" TEXT,
  "pausedAt" TIMESTAMP(3),
  "updatedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServicePointControl_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServicePointControl_servicePoint" CHECK ("servicePoint" IN ('TRIAGE', 'CONSULTATION', 'LABORATORY', 'IMAGING', 'PHARMACY', 'BILLING')),
  CONSTRAINT "ServicePointControl_pause_state" CHECK (("paused" = false AND "pauseReason" IS NULL AND "pausedAt" IS NULL) OR ("paused" = true AND "pauseReason" IS NOT NULL AND "pausedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ServicePointControl_facilityId_servicePoint_key" ON "ServicePointControl"("facilityId", "servicePoint");
CREATE INDEX "ServicePointControl_facilityId_paused_idx" ON "ServicePointControl"("facilityId", "paused");
ALTER TABLE "ServicePointControl" ADD CONSTRAINT "ServicePointControl_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServicePointControl" ADD CONSTRAINT "ServicePointControl_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReminderDelivery" (
  "id" UUID NOT NULL,
  "appointmentId" UUID NOT NULL,
  "preparedById" UUID NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'MANUAL',
  "destinationMasked" TEXT NOT NULL,
  "messageHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREPARED',
  "providerReference" TEXT,
  "failureReason" TEXT,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReminderDelivery_status" CHECK ("status" IN ('PREPARED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED'))
);
CREATE INDEX "ReminderDelivery_appointmentId_preparedAt_idx" ON "ReminderDelivery"("appointmentId", "preparedAt");
CREATE INDEX "ReminderDelivery_status_preparedAt_idx" ON "ReminderDelivery"("status", "preparedAt");
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_preparedById_fkey"
  FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MedicationSafetyRule" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "primaryConceptId" TEXT,
  "interactingConceptId" TEXT,
  "rule" JSONB NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "approvedById" UUID,
  "approvedAt" TIMESTAMP(3),
  "activeFrom" TIMESTAMP(3),
  "activeTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MedicationSafetyRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationSafetyRule_kind" CHECK ("kind" IN ('INTERACTION', 'DOSE_LIMIT', 'RENAL', 'HEPATIC', 'PREGNANCY', 'PAEDIATRIC', 'ALLERGY')),
  CONSTRAINT "MedicationSafetyRule_severity" CHECK ("severity" IN ('INFORMATION', 'WARNING', 'HARD_STOP')),
  CONSTRAINT "MedicationSafetyRule_status" CHECK ("status" IN ('DRAFT', 'APPROVED', 'RETIRED')),
  CONSTRAINT "MedicationSafetyRule_approval" CHECK (("status" <> 'APPROVED') OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "MedicationSafetyRule_facilityId_code_version_key" ON "MedicationSafetyRule"("facilityId", "code", "version");
CREATE INDEX "MedicationSafetyRule_facilityId_status_kind_idx" ON "MedicationSafetyRule"("facilityId", "status", "kind");
CREATE INDEX "MedicationSafetyRule_primaryConceptId_interactingConceptId_idx" ON "MedicationSafetyRule"("primaryConceptId", "interactingConceptId");
ALTER TABLE "MedicationSafetyRule" ADD CONSTRAINT "MedicationSafetyRule_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicationSafetyRule" ADD CONSTRAINT "MedicationSafetyRule_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MedicationSafetyAssessment" (
  "id" UUID NOT NULL,
  "prescriptionId" UUID NOT NULL,
  "ruleId" UUID,
  "warningCode" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "ruleVersion" TEXT,
  "contextHash" TEXT NOT NULL,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicationSafetyAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationSafetyAssessment_outcome" CHECK ("outcome" IN ('PASS', 'WARN', 'BLOCK', 'UNAVAILABLE'))
);
CREATE INDEX "MedicationSafetyAssessment_prescriptionId_evaluatedAt_idx" ON "MedicationSafetyAssessment"("prescriptionId", "evaluatedAt");
CREATE INDEX "MedicationSafetyAssessment_ruleId_evaluatedAt_idx" ON "MedicationSafetyAssessment"("ruleId", "evaluatedAt");
ALTER TABLE "MedicationSafetyAssessment" ADD CONSTRAINT "MedicationSafetyAssessment_prescriptionId_fkey"
  FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicationSafetyAssessment" ADD CONSTRAINT "MedicationSafetyAssessment_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "MedicationSafetyRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_medication_safety_assessment_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MedicationSafetyAssessment records are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MedicationSafetyAssessment_immutable"
BEFORE UPDATE OR DELETE ON "MedicationSafetyAssessment"
FOR EACH ROW EXECUTE FUNCTION prevent_medication_safety_assessment_mutation();

CREATE TABLE "ExternalIdentity" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "issuer" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "email" TEXT,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExternalIdentity_issuer_subject_key" ON "ExternalIdentity"("issuer", "subject");
CREATE UNIQUE INDEX "ExternalIdentity_facilityId_userId_issuer_key" ON "ExternalIdentity"("facilityId", "userId", "issuer");
CREATE INDEX "ExternalIdentity_facilityId_email_idx" ON "ExternalIdentity"("facilityId", "email");
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IdentityRoleMapping" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "providerGroup" TEXT NOT NULL,
  "roleCode" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdentityRoleMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdentityRoleMapping_facilityId_providerGroup_roleCode_key" ON "IdentityRoleMapping"("facilityId", "providerGroup", "roleCode");
CREATE INDEX "IdentityRoleMapping_facilityId_active_idx" ON "IdentityRoleMapping"("facilityId", "active");
ALTER TABLE "IdentityRoleMapping" ADD CONSTRAINT "IdentityRoleMapping_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdentityRoleMapping" ADD CONSTRAINT "IdentityRoleMapping_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
