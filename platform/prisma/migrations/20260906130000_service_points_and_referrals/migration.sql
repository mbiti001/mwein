CREATE TABLE "ServicePointRecord" (
    "id" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "servicePoint" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "riskLevel" TEXT,
    "followUpAt" DATE,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServicePointRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatientRelationship" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "relatedPatientId" UUID NOT NULL,
    "relationship" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientRelationship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Referral" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "encounterId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "referralNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "referrerName" TEXT NOT NULL,
    "referringFacility" TEXT NOT NULL,
    "referringDepartment" TEXT,
    "reason" TEXT NOT NULL,
    "clinicalSummary" TEXT NOT NULL,
    "diagnosisSummary" TEXT NOT NULL,
    "urgency" "Priority" NOT NULL DEFAULT 'ROUTINE',
    "attachedResults" JSONB NOT NULL,
    "receivingFacility" TEXT NOT NULL,
    "receivingDepartment" TEXT,
    "appointmentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "feedback" TEXT,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "attendedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServicePointRecord_encounterId_key" ON "ServicePointRecord"("encounterId");
CREATE INDEX "ServicePointRecord_servicePoint_followUpAt_idx" ON "ServicePointRecord"("servicePoint", "followUpAt");
CREATE UNIQUE INDEX "PatientRelationship_patientId_relatedPatientId_relationship_key" ON "PatientRelationship"("patientId", "relatedPatientId", "relationship");
CREATE INDEX "PatientRelationship_relatedPatientId_relationship_idx" ON "PatientRelationship"("relatedPatientId", "relationship");
CREATE UNIQUE INDEX "Referral_idempotencyKey_key" ON "Referral"("idempotencyKey");
CREATE UNIQUE INDEX "Referral_facilityId_referralNumber_key" ON "Referral"("facilityId", "referralNumber");
CREATE INDEX "Referral_facilityId_status_createdAt_idx" ON "Referral"("facilityId", "status", "createdAt");
CREATE INDEX "Referral_patientId_createdAt_idx" ON "Referral"("patientId", "createdAt");

ALTER TABLE "ServicePointRecord" ADD CONSTRAINT "ServicePointRecord_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServicePointRecord" ADD CONSTRAINT "ServicePointRecord_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientRelationship" ADD CONSTRAINT "PatientRelationship_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientRelationship" ADD CONSTRAINT "PatientRelationship_relatedPatientId_fkey" FOREIGN KEY ("relatedPatientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientRelationship" ADD CONSTRAINT "PatientRelationship_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
