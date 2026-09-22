CREATE TABLE "VisitDisposition" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "visitId" UUID NOT NULL,
  "outcome" TEXT NOT NULL,
  "details" TEXT,
  "policyVersion" TEXT NOT NULL DEFAULT 'MWEIN-VISIT-DISPOSITION-1',
  "recordedById" UUID NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitDisposition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitDisposition_visitId_key" ON "VisitDisposition"("visitId");
CREATE INDEX "VisitDisposition_facilityId_outcome_recordedAt_idx" ON "VisitDisposition"("facilityId", "outcome", "recordedAt");
ALTER TABLE "VisitDisposition" ADD CONSTRAINT "VisitDisposition_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitDisposition" ADD CONSTRAINT "VisitDisposition_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitDisposition" ADD CONSTRAINT "VisitDisposition_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
