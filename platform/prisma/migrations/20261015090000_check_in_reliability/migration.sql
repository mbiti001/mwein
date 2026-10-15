-- Stop for an attributable review of existing duplicates; never merge or close care automatically.
DO $$
BEGIN
  -- Keep the preflight and DDL atomic even when the migration runner does not wrap transactions.
  LOCK TABLE "Visit" IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1 FROM "Visit"
    WHERE "clinicallyClosedAt" IS NULL AND "status" NOT IN ('COMPLETED', 'CANCELLED', 'DISCHARGED')
    GROUP BY "facilityId", "patientId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Check-in migration blocked: review duplicate open visits before applying this migration. No patient records have been merged or closed.';
  END IF;

ALTER TABLE "Visit" ADD COLUMN "checkInKey" UUID, ADD COLUMN "checkInFingerprint" TEXT;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_check_in_pair_check" CHECK (
  ("checkInKey" IS NULL AND "checkInFingerprint" IS NULL) OR
  ("checkInKey" IS NOT NULL AND "checkInFingerprint" IS NOT NULL AND "checkInFingerprint" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "Visit_facilityId_checkInKey_key" ON "Visit"("facilityId", "checkInKey");
CREATE UNIQUE INDEX "Visit_open_patient_key" ON "Visit"("facilityId", "patientId")
  WHERE "clinicallyClosedAt" IS NULL AND "status" NOT IN ('COMPLETED', 'CANCELLED', 'DISCHARGED');
END $$;
