CREATE TABLE "Stocktake" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "stocktakeNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "openedById" UUID NOT NULL,
  "submittedById" UUID,
  "approvedById" UUID,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),

  CONSTRAINT "Stocktake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StocktakeLine" (
  "id" UUID NOT NULL,
  "stocktakeId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "systemQuantity" DECIMAL(12,3) NOT NULL,
  "countedQuantity" DECIMAL(12,3),
  "variance" DECIMAL(12,3),
  "unitCost" DECIMAL(14,2),
  "reason" TEXT,
  "countedById" UUID,
  "countedAt" TIMESTAMP(3),

  CONSTRAINT "StocktakeLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StocktakeLine_nonnegative_count" CHECK ("countedQuantity" IS NULL OR "countedQuantity" >= 0)
);

CREATE TABLE "AccountingJournal" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "entryNumber" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "postedById" UUID NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AccountingJournal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingJournalLine" (
  "id" UUID NOT NULL,
  "journalId" UUID NOT NULL,
  "accountCode" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "catalogItemId" UUID,
  "batchId" UUID,
  "storeId" UUID,

  CONSTRAINT "AccountingJournalLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountingJournalLine_one_side" CHECK (
    ("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)
  )
);

CREATE UNIQUE INDEX "Stocktake_facilityId_stocktakeNumber_key" ON "Stocktake"("facilityId", "stocktakeNumber");
CREATE INDEX "Stocktake_facilityId_status_openedAt_idx" ON "Stocktake"("facilityId", "status", "openedAt");
CREATE INDEX "Stocktake_storeId_status_idx" ON "Stocktake"("storeId", "status");
CREATE UNIQUE INDEX "Stocktake_one_active_per_store" ON "Stocktake"("storeId") WHERE "status" IN ('OPEN', 'SUBMITTED');
CREATE UNIQUE INDEX "StocktakeLine_stocktakeId_batchId_key" ON "StocktakeLine"("stocktakeId", "batchId");
CREATE INDEX "StocktakeLine_batchId_idx" ON "StocktakeLine"("batchId");
CREATE UNIQUE INDEX "AccountingJournal_facilityId_entryNumber_key" ON "AccountingJournal"("facilityId", "entryNumber");
CREATE UNIQUE INDEX "AccountingJournal_sourceType_sourceId_key" ON "AccountingJournal"("sourceType", "sourceId");
CREATE INDEX "AccountingJournal_facilityId_occurredAt_idx" ON "AccountingJournal"("facilityId", "occurredAt");
CREATE INDEX "AccountingJournalLine_journalId_idx" ON "AccountingJournalLine"("journalId");
CREATE INDEX "AccountingJournalLine_accountCode_idx" ON "AccountingJournalLine"("accountCode");
CREATE INDEX "AccountingJournalLine_catalogItemId_idx" ON "AccountingJournalLine"("catalogItemId");

ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingJournal" ADD CONSTRAINT "AccountingJournal_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingJournal" ADD CONSTRAINT "AccountingJournal_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingJournalLine" ADD CONSTRAINT "AccountingJournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "AccountingJournal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Consolidate the two overlapping pharmacy-support assignments into the
-- pharmacy officer and pharmacy manager roles. Transaction maker-checker
-- rules still prevent one person from approving their own work.
INSERT INTO "UserRole" ("userId", "roleId")
SELECT ur."userId", target."id"
FROM "UserRole" ur
JOIN "Role" legacy ON legacy."id" = ur."roleId"
JOIN "Role" target ON target."code" = CASE
  WHEN legacy."code" = 'INVENTORY_CLERK' THEN 'PHARMACY'
  WHEN legacy."code" = 'PROCUREMENT_APPROVER' THEN 'PHARMACY_MANAGER'
END
WHERE legacy."code" IN ('INVENTORY_CLERK', 'PROCUREMENT_APPROVER')
ON CONFLICT DO NOTHING;

DELETE FROM "UserRole" ur
USING "Role" legacy
WHERE legacy."id" = ur."roleId"
  AND legacy."code" IN ('INVENTORY_CLERK', 'PROCUREMENT_APPROVER');
