ALTER TABLE "CatalogItem"
  ADD COLUMN "medicationConceptId" TEXT,
  ADD COLUMN "therapeuticClass" TEXT;

ALTER TABLE "Prescription"
  ADD COLUMN "catalogItemId" UUID,
  ADD COLUMN "medicationConceptId" TEXT,
  ADD COLUMN "genericName" TEXT,
  ADD COLUMN "strength" TEXT,
  ADD COLUMN "dosageForm" TEXT,
  ADD COLUMN "startDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN "stopDate" DATE,
  ADD COLUMN "isPrn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "prnIndication" TEXT,
  ADD COLUMN "doseTiming" TEXT NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN "sequenceNote" TEXT,
  ADD COLUMN "encounterId" UUID,
  ADD COLUMN "diagnosisId" UUID,
  ADD COLUMN "idempotencyKey" TEXT;

UPDATE "Prescription" SET "instructions" = 'Use as directed' WHERE "instructions" IS NULL;
UPDATE "Prescription" AS p
SET "catalogItemId" = c."id",
    "medicationConceptId" = COALESCE(c."medicationConceptId", lower(regexp_replace(c."genericName", '[^a-zA-Z0-9]+', '-', 'g'))),
    "genericName" = c."genericName",
    "strength" = c."strength",
    "dosageForm" = c."dosageForm"
FROM "ClinicalOrder" AS o, "Visit" AS v, "CatalogItem" AS c
WHERE p."orderId" = o."id" AND v."id" = o."visitId"
  AND c."facilityId" = v."facilityId" AND upper(c."code") = upper(p."medicineCode");
UPDATE "Prescription" AS p
SET "encounterId" = e."id"
FROM "ClinicalOrder" AS o
JOIN LATERAL (
  SELECT "id" FROM "Encounter" WHERE "visitId" = o."visitId" ORDER BY "createdAt" DESC LIMIT 1
) AS e ON true
WHERE p."orderId" = o."id";
UPDATE "Prescription" AS p
SET "diagnosisId" = d."id"
FROM "Diagnosis" AS d
WHERE d."encounterId" = p."encounterId" AND d."primary" = true;
ALTER TABLE "Prescription" ALTER COLUMN "instructions" SET NOT NULL;
ALTER TABLE "Prescription" ALTER COLUMN "duration" DROP NOT NULL;

CREATE UNIQUE INDEX "Prescription_idempotencyKey_key" ON "Prescription"("idempotencyKey");
CREATE INDEX "Prescription_medicationConceptId_strength_dosageForm_startDate_stopDate_idx"
  ON "Prescription"("medicationConceptId", "strength", "dosageForm", "startDate", "stopDate");

ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_catalogItemId_fkey"
  FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_encounterId_fkey"
  FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_diagnosisId_fkey"
  FOREIGN KEY ("diagnosisId") REFERENCES "Diagnosis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MedicationSafetyOverride" (
  "id" UUID NOT NULL,
  "prescriptionId" UUID NOT NULL,
  "existingPrescriptionId" UUID,
  "prescriberId" UUID NOT NULL,
  "warningCode" TEXT NOT NULL,
  "justification" TEXT NOT NULL,
  "originalDetails" JSONB,
  "revisedDetails" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicationSafetyOverride_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MedicationSafetyOverride_prescriptionId_createdAt_idx"
  ON "MedicationSafetyOverride"("prescriptionId", "createdAt");
ALTER TABLE "MedicationSafetyOverride" ADD CONSTRAINT "MedicationSafetyOverride_prescriptionId_fkey"
  FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicationSafetyOverride" ADD CONSTRAINT "MedicationSafetyOverride_existingPrescriptionId_fkey"
  FOREIGN KEY ("existingPrescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MedicationSafetyOverride" ADD CONSTRAINT "MedicationSafetyOverride_prescriberId_fkey"
  FOREIGN KEY ("prescriberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
