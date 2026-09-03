ALTER TABLE "Diagnosis"
ADD COLUMN "codingSystem" TEXT NOT NULL DEFAULT 'ICD-11 MMS',
ADD COLUMN "code" TEXT,
ADD COLUMN "foundationUri" TEXT;

CREATE TABLE "LaboratoryResult" (
    "id" UUID NOT NULL,
    "laboratoryOrderId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reportText" TEXT,
    "recordedById" UUID NOT NULL,
    "verifiedById" UUID,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    CONSTRAINT "LaboratoryResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LaboratoryResultItem" (
    "id" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "analyte" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "referenceRange" TEXT,
    "flag" TEXT,
    CONSTRAINT "LaboratoryResultItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LaboratoryResult_laboratoryOrderId_key" ON "LaboratoryResult"("laboratoryOrderId");
ALTER TABLE "LaboratoryResult" ADD CONSTRAINT "LaboratoryResult_laboratoryOrderId_fkey" FOREIGN KEY ("laboratoryOrderId") REFERENCES "LaboratoryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaboratoryResult" ADD CONSTRAINT "LaboratoryResult_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaboratoryResult" ADD CONSTRAINT "LaboratoryResult_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LaboratoryResultItem" ADD CONSTRAINT "LaboratoryResultItem_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "LaboratoryResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
