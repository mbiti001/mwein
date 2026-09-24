-- CreateEnum
CREATE TYPE "LocalReportStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED');

-- CreateTable
CREATE TABLE "LocalReportRevision" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "previousId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "LocalReportStatus" NOT NULL DEFAULT 'DRAFT',
    "month" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "preparedById" UUID NOT NULL,
    "contributorIds" UUID[] NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocalReportRevision_previousId_key" ON "LocalReportRevision"("previousId");

-- CreateIndex
CREATE INDEX "LocalReportRevision_facilityId_createdAt_idx" ON "LocalReportRevision"("facilityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocalReportRevision_facilityId_familyId_revision_key" ON "LocalReportRevision"("facilityId", "familyId", "revision");

-- AddForeignKey
ALTER TABLE "LocalReportRevision" ADD CONSTRAINT "LocalReportRevision_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalReportRevision" ADD CONSTRAINT "LocalReportRevision_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalReportRevision" ADD CONSTRAINT "LocalReportRevision_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalReportRevision" ADD CONSTRAINT "LocalReportRevision_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "LocalReportRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "LocalReportRevision" ADD CONSTRAINT "LocalReportRevision_positive_versions" CHECK ("version" > 0 AND "revision" > 0);
ALTER TABLE "LocalReportRevision" ADD CONSTRAINT "LocalReportRevision_approval_evidence" CHECK (
  "status" <> 'APPROVED' OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND NOT ("reviewedById" = ANY("contributorIds")))
);
CREATE FUNCTION protect_approved_local_report() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."status" = 'APPROVED' THEN
    RAISE EXCEPTION 'Local report history is immutable; create a correction revision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LocalReportRevision_immutable" BEFORE UPDATE OR DELETE ON "LocalReportRevision"
FOR EACH ROW EXECUTE FUNCTION protect_approved_local_report();

ALTER TABLE "LocalReportRevision" ADD CONSTRAINT "LocalReportRevision_contributors" CHECK (cardinality("contributorIds") > 0 AND "preparedById" = ANY("contributorIds"));
