ALTER TABLE "StockMovement" ADD COLUMN "sourceStoreId" UUID;
ALTER TABLE "StockMovement" ADD COLUMN "destinationStoreId" UUID;
ALTER TABLE "StockMovement" ADD COLUMN "sourceBalanceAfter" DECIMAL(12,3);
ALTER TABLE "StockMovement" ADD COLUMN "destinationBalanceAfter" DECIMAL(12,3);

CREATE INDEX "StockMovement_sourceStoreId_occurredAt_idx" ON "StockMovement"("sourceStoreId", "occurredAt");
CREATE INDEX "StockMovement_destinationStoreId_occurredAt_idx" ON "StockMovement"("destinationStoreId", "occurredAt");

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sourceStoreId_fkey" FOREIGN KEY ("sourceStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_destinationStoreId_fkey" FOREIGN KEY ("destinationStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
