ALTER TABLE "CatalogItem"
  ADD COLUMN "synonyms" TEXT,
  ADD COLUMN "loincCode" TEXT,
  ADD COLUMN "department" TEXT,
  ADD COLUMN "panelOrSingle" TEXT,
  ADD COLUMN "container" TEXT,
  ADD COLUMN "method" TEXT,
  ADD COLUMN "turnaroundMinutes" INTEGER,
  ADD COLUMN "reportableToKhis" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "khisMapping" TEXT;

ALTER TABLE "LabReferenceRange"
  ADD COLUMN "componentCode" TEXT,
  ADD COLUMN "loincCode" TEXT,
  ADD COLUMN "unitUcum" TEXT,
  ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "analyser" TEXT,
  ADD COLUMN "pregnancyStage" TEXT,
  ADD COLUMN "approvedBy" TEXT;

ALTER TABLE "LaboratoryResult"
  ADD COLUMN "criticalReadBack" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "criticalEscalation" TEXT,
  ADD COLUMN "criticalConfirmation" TEXT,
  ADD COLUMN "analyserCode" TEXT,
  ADD COLUMN "method" TEXT;

ALTER TABLE "LaboratoryResultItem"
  ADD COLUMN "componentCode" TEXT,
  ADD COLUMN "loincCode" TEXT,
  ADD COLUMN "comparator" TEXT,
  ADD COLUMN "analyserFlag" TEXT;
