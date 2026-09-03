CREATE TABLE "LabReferenceRange" (
    "id" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "analyte" TEXT NOT NULL,
    "unit" TEXT,
    "sexAtBirth" TEXT NOT NULL DEFAULT 'ANY',
    "minAgeDays" INTEGER,
    "maxAgeDays" INTEGER,
    "lowerLimit" DECIMAL(18,6),
    "upperLimit" DECIMAL(18,6),
    "criticalLow" DECIMAL(18,6),
    "criticalHigh" DECIMAL(18,6),
    "qualitativeValues" TEXT,
    "method" TEXT,
    "source" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LabReferenceRange_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LaboratoryOrder" ADD COLUMN "accessionNumber" TEXT, ADD COLUMN "collectedAt" TIMESTAMP(3), ADD COLUMN "receivedAt" TIMESTAMP(3), ADD COLUMN "specimenCondition" TEXT;
ALTER TABLE "LaboratoryResult" ADD COLUMN "criticalResult" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "criticalNotifiedTo" TEXT, ADD COLUMN "criticalNotificationMethod" TEXT, ADD COLUMN "criticalNotifiedAt" TIMESTAMP(3);
ALTER TABLE "LaboratoryResultItem" ADD COLUMN "numericValue" DECIMAL(18,6), ADD COLUMN "critical" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "referenceRangeId" UUID;
CREATE INDEX "LabReferenceRange_catalogItemId_active_idx" ON "LabReferenceRange"("catalogItemId", "active");
ALTER TABLE "LabReferenceRange" ADD CONSTRAINT "LabReferenceRange_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
