ALTER TABLE "Prescription"
  ADD COLUMN "doseQuantity" DECIMAL(12,3),
  ADD COLUMN "frequencyPerDay" INTEGER,
  ADD COLUMN "durationDays" INTEGER,
  ADD COLUMN "quantityConfirmed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ClinicalOrder"
  ADD CONSTRAINT "ClinicalOrder_orderedById_fkey"
  FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ClinicalOrder_orderedById_requestedAt_idx"
  ON "ClinicalOrder"("orderedById", "requestedAt");

CREATE TABLE "EncounterAddendum" (
  "id" UUID NOT NULL,
  "encounterId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EncounterAddendum_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "EncounterAddendum" ADD CONSTRAINT "EncounterAddendum_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EncounterAddendum" ADD CONSTRAINT "EncounterAddendum_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "EncounterAddendum_encounterId_createdAt_idx" ON "EncounterAddendum"("encounterId", "createdAt");

CREATE TABLE "Supplier" ("id" UUID NOT NULL,"facilityId" UUID NOT NULL,"code" TEXT NOT NULL,"name" TEXT NOT NULL,"phone" TEXT,"email" TEXT,"active" BOOLEAN NOT NULL DEFAULT true,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id"));
CREATE TABLE "Store" ("id" UUID NOT NULL,"facilityId" UUID NOT NULL,"code" TEXT NOT NULL,"name" TEXT NOT NULL,"active" BOOLEAN NOT NULL DEFAULT true,CONSTRAINT "Store_pkey" PRIMARY KEY ("id"));
CREATE TABLE "InventoryLocationBalance" ("id" UUID NOT NULL,"storeId" UUID NOT NULL,"batchId" UUID NOT NULL,"quantity" DECIMAL(12,3) NOT NULL,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "InventoryLocationBalance_pkey" PRIMARY KEY ("id"));
CREATE TABLE "PurchaseOrder" ("id" UUID NOT NULL,"facilityId" UUID NOT NULL,"supplierId" UUID NOT NULL,"orderNumber" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'DRAFT',"expectedAt" DATE,"notes" TEXT,"createdById" UUID NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"receivedAt" TIMESTAMP(3),CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id"));
CREATE TABLE "PurchaseOrderLine" ("id" UUID NOT NULL,"purchaseOrderId" UUID NOT NULL,"catalogItemId" UUID NOT NULL,"quantityOrdered" DECIMAL(12,3) NOT NULL,"quantityReceived" DECIMAL(12,3) NOT NULL DEFAULT 0,"unitCost" DECIMAL(14,2),CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id"));
CREATE TABLE "InventoryControlEvent" ("id" UUID NOT NULL,"facilityId" UUID NOT NULL,"type" TEXT NOT NULL,"storeId" UUID NOT NULL,"destinationStoreId" UUID,"batchId" UUID NOT NULL,"quantity" DECIMAL(12,3) NOT NULL,"variance" DECIMAL(12,3),"reason" TEXT NOT NULL,"recordedById" UUID NOT NULL,"occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "InventoryControlEvent_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Supplier_facilityId_code_key" ON "Supplier"("facilityId","code");
CREATE UNIQUE INDEX "Store_facilityId_code_key" ON "Store"("facilityId","code");
CREATE UNIQUE INDEX "InventoryLocationBalance_storeId_batchId_key" ON "InventoryLocationBalance"("storeId","batchId");
CREATE INDEX "InventoryLocationBalance_batchId_idx" ON "InventoryLocationBalance"("batchId");
CREATE UNIQUE INDEX "PurchaseOrder_facilityId_orderNumber_key" ON "PurchaseOrder"("facilityId","orderNumber");
CREATE INDEX "PurchaseOrderLine_catalogItemId_idx" ON "PurchaseOrderLine"("catalogItemId");
CREATE INDEX "InventoryControlEvent_facilityId_type_occurredAt_idx" ON "InventoryControlEvent"("facilityId","type","occurredAt");
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Store" ADD CONSTRAINT "Store_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryLocationBalance" ADD CONSTRAINT "InventoryLocationBalance_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLocationBalance" ADD CONSTRAINT "InventoryLocationBalance_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryControlEvent" ADD CONSTRAINT "InventoryControlEvent_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryControlEvent" ADD CONSTRAINT "InventoryControlEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryControlEvent" ADD CONSTRAINT "InventoryControlEvent_destinationStoreId_fkey" FOREIGN KEY ("destinationStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryControlEvent" ADD CONSTRAINT "InventoryControlEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryControlEvent" ADD CONSTRAINT "InventoryControlEvent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Store" ("id","facilityId","code","name") SELECT gen_random_uuid(),"id",'MAIN','Main pharmacy store' FROM "Facility";
INSERT INTO "InventoryLocationBalance" ("id","storeId","batchId","quantity","updatedAt") SELECT gen_random_uuid(),s."id",b."id",b."quantityAvailable",CURRENT_TIMESTAMP FROM "InventoryBatch" b JOIN "CatalogItem" c ON c."id"=b."catalogItemId" JOIN "Store" s ON s."facilityId"=c."facilityId" AND s."code"='MAIN';
