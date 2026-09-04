ALTER TABLE "Prescription"
  ADD COLUMN "counsellingCompleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "counselledAt" TIMESTAMP(3);

CREATE INDEX "StockMovement_prescriptionId_occurredAt_idx"
  ON "StockMovement"("prescriptionId", "occurredAt");

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_prescriptionId_fkey"
  FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
