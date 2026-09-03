ALTER TABLE "LaboratoryOrder" ADD COLUMN "specimenStatus" TEXT NOT NULL DEFAULT 'NOT_COLLECTED', ADD COLUMN "collectedById" UUID, ADD COLUMN "receivedById" UUID, ADD COLUMN "rejectionReason" TEXT;
CREATE UNIQUE INDEX "LaboratoryOrder_accessionNumber_key" ON "LaboratoryOrder"("accessionNumber");
