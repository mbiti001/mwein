CREATE TABLE "GoodsReceipt" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "purchaseOrderId" UUID NOT NULL,
  "movementId" UUID NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snapshot" JSONB NOT NULL,
  CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoodsReceipt_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GoodsReceipt_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoodsReceipt_movementId_key" ON "GoodsReceipt"("movementId");
CREATE UNIQUE INDEX "GoodsReceipt_facilityId_receiptNumber_key" ON "GoodsReceipt"("facilityId", "receiptNumber");
CREATE INDEX "GoodsReceipt_facilityId_receivedAt_idx" ON "GoodsReceipt"("facilityId", "receivedAt");

CREATE FUNCTION protect_goods_receipt() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Posted goods receipts are immutable; retain the original and record stock corrections separately';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "GoodsReceipt_immutable" BEFORE UPDATE OR DELETE ON "GoodsReceipt"
FOR EACH ROW EXECUTE FUNCTION protect_goods_receipt();

-- Historical movements lack the original supplier, price and expiry snapshot.
-- Do not fabricate retrospective receipt documents from today's catalogue.
