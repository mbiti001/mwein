ALTER TABLE "Claim"
ADD COLUMN "shaPreparation" JSONB;

CREATE TABLE "ShaContractProfile" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "draftVersion" TEXT NOT NULL DEFAULT '2026-09-09',
  "contractReference" TEXT,
  "facilityFid" TEXT,
  "regulatorRegistration" TEXT,
  "countyOffice" TEXT,
  "effectiveDate" DATE,
  "facilityTier" TEXT,
  "enabledFunds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tariffScheduleVersion" TEXT,
  "pomsfAccessMatrixVersion" TEXT,
  "notes" TEXT,
  "updatedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShaContractProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShaContractProfile_status" CHECK ("status" IN ('DRAFT', 'PREPARING', 'EXECUTED')),
  CONSTRAINT "ShaContractProfile_enabledFunds" CHECK ("enabledFunds" <@ ARRAY['PHF','SHIF','ECCIF','POMSF']::TEXT[])
);
CREATE UNIQUE INDEX "ShaContractProfile_facilityId_key" ON "ShaContractProfile"("facilityId");
CREATE INDEX "ShaContractProfile_status_updatedAt_idx" ON "ShaContractProfile"("status", "updatedAt");
ALTER TABLE "ShaContractProfile" ADD CONSTRAINT "ShaContractProfile_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShaContractProfile" ADD CONSTRAINT "ShaContractProfile_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
