-- Additive evidence only. Historical completed requests are not retrospectively
-- labelled delivered, and no patient records or prior deadlines are rewritten.
ALTER TABLE "DataSubjectRequest"
  ADD COLUMN "responsePreparedAt" TIMESTAMP(3),
  ADD COLUMN "responseEvidenceReference" TEXT,
  ADD COLUMN "deliveryEvidence" JSONB;

ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_response_pair_check"
  CHECK (("responsePreparedAt" IS NULL) = ("responseEvidenceReference" IS NULL));
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_delivery_check"
  CHECK ("deliveryEvidence" IS NULL OR
    (jsonb_typeof("deliveryEvidence") = 'object' AND "status" = 'COMPLETED'
     AND "completedAt" IS NOT NULL AND "responseEvidenceReference" IS NOT NULL));
