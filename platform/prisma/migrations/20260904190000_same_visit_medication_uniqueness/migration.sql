ALTER TABLE "Prescription" ADD COLUMN "visitMedicationKey" TEXT;

WITH ranked AS (
  SELECT
    p."id",
    o."visitId"::text || ':' || p."medicationConceptId" AS medication_key,
    ROW_NUMBER() OVER (
      PARTITION BY o."visitId", p."medicationConceptId"
      ORDER BY p."id"
    ) AS position
  FROM "Prescription" p
  INNER JOIN "ClinicalOrder" o ON o."id" = p."orderId"
  WHERE p."medicationConceptId" IS NOT NULL
)
UPDATE "Prescription" p
SET "visitMedicationKey" = ranked.medication_key
FROM ranked
WHERE p."id" = ranked."id" AND ranked.position = 1;

CREATE UNIQUE INDEX "Prescription_visitMedicationKey_key"
  ON "Prescription"("visitMedicationKey");
