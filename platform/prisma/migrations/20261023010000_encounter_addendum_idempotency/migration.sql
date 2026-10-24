ALTER TABLE "EncounterAddendum" ADD COLUMN "idempotencyKey" UUID;

CREATE UNIQUE INDEX "EncounterAddendum_idempotencyKey_key"
  ON "EncounterAddendum"("idempotencyKey");
