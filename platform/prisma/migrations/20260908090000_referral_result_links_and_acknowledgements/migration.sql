ALTER TABLE "Referral" ALTER COLUMN "attachedResults" SET DEFAULT '[]'::jsonb;

CREATE TABLE "ReferralAttachment" (
  "id" UUID NOT NULL,
  "referralId" UUID NOT NULL,
  "sourceType" TEXT NOT NULL,
  "laboratoryResultId" UUID,
  "imagingResultId" UUID,
  "metadataVersion" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB NOT NULL,
  "attachedById" UUID NOT NULL,
  "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReferralAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReferralAttachment_one_source" CHECK (
    ("sourceType" = 'LABORATORY_RESULT' AND "laboratoryResultId" IS NOT NULL AND "imagingResultId" IS NULL) OR
    ("sourceType" = 'IMAGING_RESULT' AND "imagingResultId" IS NOT NULL AND "laboratoryResultId" IS NULL)
  ),
  CONSTRAINT "ReferralAttachment_metadata_version" CHECK ("metadataVersion" > 0)
);

CREATE TABLE "ReferralAcknowledgement" (
  "id" UUID NOT NULL,
  "referralId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "referralStatus" TEXT NOT NULL,
  "providerName" TEXT NOT NULL,
  "providerRole" TEXT,
  "registrationNumber" TEXT,
  "note" TEXT,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL,
  "recordedById" UUID NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReferralAcknowledgement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReferralAcknowledgement_event_type" CHECK ("eventType" IN ('ACCEPTED', 'ATTENDED', 'RETURNED'))
);

CREATE UNIQUE INDEX "ReferralAttachment_referralId_laboratoryResultId_key" ON "ReferralAttachment"("referralId", "laboratoryResultId");
CREATE UNIQUE INDEX "ReferralAttachment_referralId_imagingResultId_key" ON "ReferralAttachment"("referralId", "imagingResultId");
CREATE INDEX "ReferralAttachment_laboratoryResultId_idx" ON "ReferralAttachment"("laboratoryResultId");
CREATE INDEX "ReferralAttachment_imagingResultId_idx" ON "ReferralAttachment"("imagingResultId");
CREATE INDEX "ReferralAcknowledgement_referralId_acknowledgedAt_idx" ON "ReferralAcknowledgement"("referralId", "acknowledgedAt");

ALTER TABLE "ReferralAttachment" ADD CONSTRAINT "ReferralAttachment_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAttachment" ADD CONSTRAINT "ReferralAttachment_laboratoryResultId_fkey" FOREIGN KEY ("laboratoryResultId") REFERENCES "LaboratoryResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAttachment" ADD CONSTRAINT "ReferralAttachment_imagingResultId_fkey" FOREIGN KEY ("imagingResultId") REFERENCES "ImagingResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAttachment" ADD CONSTRAINT "ReferralAttachment_attachedById_fkey" FOREIGN KEY ("attachedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAcknowledgement" ADD CONSTRAINT "ReferralAcknowledgement_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAcknowledgement" ADD CONSTRAINT "ReferralAcknowledgement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_referral_clinical_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReferralAttachment_immutable"
BEFORE UPDATE OR DELETE ON "ReferralAttachment"
FOR EACH ROW EXECUTE FUNCTION prevent_referral_clinical_event_mutation();

CREATE TRIGGER "ReferralAcknowledgement_immutable"
BEFORE UPDATE OR DELETE ON "ReferralAcknowledgement"
FOR EACH ROW EXECUTE FUNCTION prevent_referral_clinical_event_mutation();
