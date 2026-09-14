ALTER TABLE "Dispensation" ADD COLUMN "catalogItemId" UUID;
ALTER TABLE "Dispensation" ADD COLUMN "substitutionReason" TEXT;
ALTER TABLE "Dispensation" ADD COLUMN "fefoOverrideReason" TEXT;

CREATE INDEX "Dispensation_catalogItemId_dispensedAt_idx" ON "Dispensation"("catalogItemId", "dispensedAt");

ALTER TABLE "Dispensation" ADD CONSTRAINT "Dispensation_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
