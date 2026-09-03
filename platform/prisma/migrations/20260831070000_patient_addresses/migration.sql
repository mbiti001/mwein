CREATE TABLE "PatientAddress" (
  "id" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "county" TEXT NOT NULL,
  "subcounty" TEXT NOT NULL,
  "ward" TEXT,
  "village" TEXT,
  "address" TEXT,
  "primary" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "PatientAddress_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PatientAddress"
  ADD CONSTRAINT "PatientAddress_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
