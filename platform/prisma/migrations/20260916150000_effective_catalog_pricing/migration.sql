CREATE TABLE "CatalogPriceVersion" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "catalogItemId" UUID NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "costPrice" DECIMAL(14,2),
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogPriceVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogPriceVersion_catalogItemId_effectiveFrom_key"
  ON "CatalogPriceVersion"("catalogItemId", "effectiveFrom");
CREATE INDEX "CatalogPriceVersion_facilityId_effectiveFrom_idx"
  ON "CatalogPriceVersion"("facilityId", "effectiveFrom");
CREATE INDEX "CatalogPriceVersion_catalogItemId_effectiveFrom_idx"
  ON "CatalogPriceVersion"("catalogItemId", "effectiveFrom");

ALTER TABLE "CatalogPriceVersion"
  ADD CONSTRAINT "CatalogPriceVersion_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogPriceVersion"
  ADD CONSTRAINT "CatalogPriceVersion_catalogItemId_fkey"
  FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogPriceVersion"
  ADD CONSTRAINT "CatalogPriceVersion_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "CatalogPriceVersion" (
  "id", "facilityId", "catalogItemId", "unitPrice", "costPrice", "currency",
  "effectiveFrom", "reason", "createdById", "createdAt"
)
SELECT
  "id", "facilityId", "id", "unitPrice", "costPrice", "currency",
  "createdAt", 'Baseline catalogue price migrated from the active catalogue', NULL, "createdAt"
FROM "CatalogItem";

ALTER TABLE "InvoiceItem" ADD COLUMN "catalogItemId" UUID;
ALTER TABLE "InvoiceItem" ADD COLUMN "priceVersionId" UUID;

UPDATE "InvoiceItem" AS line
SET "catalogItemId" = item."id"
FROM "Invoice" AS invoice, "Visit" AS visit, "CatalogItem" AS item
WHERE line."invoiceId" = invoice."id"
  AND invoice."visitId" = visit."id"
  AND item."facilityId" = visit."facilityId"
  AND item."code" = CASE
    WHEN line."serviceCode" LIKE 'LAB-%' THEN SUBSTRING(line."serviceCode" FROM 5)
    WHEN line."serviceCode" LIKE 'IMG-%' THEN SUBSTRING(line."serviceCode" FROM 5)
    WHEN line."serviceCode" LIKE 'MED-%' THEN SUBSTRING(line."serviceCode" FROM 5)
    ELSE NULL
  END;

UPDATE "InvoiceItem" AS line
SET "priceVersionId" = (
  SELECT candidate."id"
  FROM "CatalogPriceVersion" AS candidate
  WHERE candidate."catalogItemId" = line."catalogItemId"
    AND candidate."effectiveFrom" <= (
      SELECT invoice."createdAt" FROM "Invoice" AS invoice WHERE invoice."id" = line."invoiceId"
    )
  ORDER BY candidate."effectiveFrom" DESC
  LIMIT 1
)
WHERE line."catalogItemId" IS NOT NULL;

CREATE INDEX "InvoiceItem_catalogItemId_idx" ON "InvoiceItem"("catalogItemId");
CREATE INDEX "InvoiceItem_priceVersionId_idx" ON "InvoiceItem"("priceVersionId");

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_catalogItemId_fkey"
  FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_priceVersionId_fkey"
  FOREIGN KEY ("priceVersionId") REFERENCES "CatalogPriceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
