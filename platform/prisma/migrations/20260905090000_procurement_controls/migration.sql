ALTER TABLE "PurchaseOrder"
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "submittedById" UUID,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedById" UUID,
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledById" UUID,
ADD COLUMN "cancellationReason" TEXT,
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "PurchaseOrder_idempotencyKey_key" ON "PurchaseOrder"("idempotencyKey");

ALTER TABLE "InventoryControlEvent"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'POSTED',
ADD COLUMN "approvedById" UUID,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "InventoryControlEvent_idempotencyKey_key" ON "InventoryControlEvent"("idempotencyKey");

CREATE TABLE "SupplyOperation" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplyOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplyOperation_idempotencyKey_key" ON "SupplyOperation"("idempotencyKey");
CREATE INDEX "SupplyOperation_facilityId_action_createdAt_idx" ON "SupplyOperation"("facilityId", "action", "createdAt");
