CREATE TABLE "Dispensation" (
  "id" UUID NOT NULL,
  "prescriptionId" UUID NOT NULL,
  "dispensedById" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "counsellingCompleted" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "dispensedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Dispensation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DispensationItem" (
  "id" UUID NOT NULL,
  "dispensationId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "unitCost" DECIMAL(14,2),
  CONSTRAINT "DispensationItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StockMovement" ADD COLUMN "dispensationId" UUID;

CREATE UNIQUE INDEX "Dispensation_idempotencyKey_key" ON "Dispensation"("idempotencyKey");
CREATE INDEX "Dispensation_prescriptionId_dispensedAt_idx" ON "Dispensation"("prescriptionId", "dispensedAt");
CREATE UNIQUE INDEX "DispensationItem_dispensationId_batchId_key" ON "DispensationItem"("dispensationId", "batchId");
CREATE INDEX "StockMovement_dispensationId_idx" ON "StockMovement"("dispensationId");

ALTER TABLE "Dispensation" ADD CONSTRAINT "Dispensation_prescriptionId_fkey"
  FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Dispensation" ADD CONSTRAINT "Dispensation_dispensedById_fkey"
  FOREIGN KEY ("dispensedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DispensationItem" ADD CONSTRAINT "DispensationItem_dispensationId_fkey"
  FOREIGN KEY ("dispensationId") REFERENCES "Dispensation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DispensationItem" ADD CONSTRAINT "DispensationItem_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_dispensationId_fkey"
  FOREIGN KEY ("dispensationId") REFERENCES "Dispensation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reconcile legacy medicine charges to quantities that were actually supplied.
UPDATE "InvoiceItem" AS line
SET "quantity" = prescription."dispensedQuantity"
FROM "ClinicalOrder" AS clinical_order, "Prescription" AS prescription
WHERE line."orderId" = clinical_order."id"
  AND prescription."orderId" = clinical_order."id"
  AND clinical_order."type" = 'MEDICATION'
  AND EXISTS (SELECT 1 FROM "Invoice" WHERE "id" = line."invoiceId" AND "status" <> 'PAID')
  AND COALESCE(prescription."dispensedQuantity", 0) > 0;

DELETE FROM "InvoiceItem" AS line
USING "ClinicalOrder" AS clinical_order, "Prescription" AS prescription
WHERE line."orderId" = clinical_order."id"
  AND prescription."orderId" = clinical_order."id"
  AND clinical_order."type" = 'MEDICATION'
  AND EXISTS (SELECT 1 FROM "Invoice" WHERE "id" = line."invoiceId" AND "status" <> 'PAID')
  AND COALESCE(prescription."dispensedQuantity", 0) = 0;
