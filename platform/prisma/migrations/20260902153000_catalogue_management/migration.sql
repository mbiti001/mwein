CREATE TYPE "CatalogCategory" AS ENUM ('LABORATORY_TEST', 'PROCEDURE', 'PHARMACEUTICAL', 'NON_PHARMACEUTICAL');

CREATE TABLE "CatalogItem" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "category" "CatalogCategory" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "specimenType" TEXT,
    "modality" TEXT,
    "genericName" TEXT,
    "strength" TEXT,
    "dosageForm" TEXT,
    "unitOfMeasure" TEXT,
    "reorderLevel" DECIMAL(12,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogItem_facilityId_code_key" ON "CatalogItem"("facilityId", "code");
CREATE INDEX "CatalogItem_facilityId_category_active_idx" ON "CatalogItem"("facilityId", "category", "active");
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
