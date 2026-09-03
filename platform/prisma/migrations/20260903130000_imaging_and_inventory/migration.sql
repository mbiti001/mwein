CREATE TABLE "ImagingResult" (
  "id" UUID NOT NULL, "imagingOrderId" UUID NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "technique" TEXT, "findings" TEXT NOT NULL, "conclusion" TEXT NOT NULL, "recommendations" TEXT,
  "performedAt" TIMESTAMP(3) NOT NULL, "performedById" UUID NOT NULL, "verifiedAt" TIMESTAMP(3), "verifiedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImagingResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImagingResult_imagingOrderId_key" ON "ImagingResult"("imagingOrderId");
ALTER TABLE "ImagingResult" ADD CONSTRAINT "ImagingResult_imagingOrderId_fkey" FOREIGN KEY ("imagingOrderId") REFERENCES "ImagingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImagingResult" ADD CONSTRAINT "ImagingResult_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingResult" ADD CONSTRAINT "ImagingResult_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InventoryBatch" ("id" UUID NOT NULL,"catalogItemId" UUID NOT NULL,"batchNumber" TEXT NOT NULL,"expiryDate" DATE NOT NULL,"quantityReceived" DECIMAL(12,3) NOT NULL,"quantityAvailable" DECIMAL(12,3) NOT NULL,"unitCost" DECIMAL(14,2),"receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"active" BOOLEAN NOT NULL DEFAULT true,CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id"));
CREATE TABLE "StockMovement" ("id" UUID NOT NULL,"batchId" UUID NOT NULL,"userId" UUID NOT NULL,"prescriptionId" UUID,"type" TEXT NOT NULL,"quantity" DECIMAL(12,3) NOT NULL,"balanceAfter" DECIMAL(12,3) NOT NULL,"reason" TEXT,"occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "InventoryBatch_catalogItemId_batchNumber_key" ON "InventoryBatch"("catalogItemId","batchNumber");
CREATE INDEX "InventoryBatch_catalogItemId_active_expiryDate_idx" ON "InventoryBatch"("catalogItemId","active","expiryDate");
CREATE INDEX "StockMovement_batchId_occurredAt_idx" ON "StockMovement"("batchId","occurredAt");
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
