CREATE TABLE "DiagnosticReview" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orderId" UUID NOT NULL REFERENCES "ClinicalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "action" TEXT NOT NULL CHECK ("action" IN ('CLAIM', 'ACKNOWLEDGE')),
  "note" TEXT NOT NULL CHECK (length(trim("note")) BETWEEN 3 AND 2000),
  "resultId" UUID,
  "verifiedAt" TIMESTAMP(3),
  "requestKey" UUID NOT NULL,
  "requestHash" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiagnosticReview_report_evidence" CHECK (
    ("action" = 'CLAIM' AND "resultId" IS NULL AND "verifiedAt" IS NULL) OR
    ("action" = 'ACKNOWLEDGE' AND "resultId" IS NOT NULL AND "verifiedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "DiagnosticReview_orderId_sequence_key" ON "DiagnosticReview"("orderId", "sequence");
CREATE UNIQUE INDEX "DiagnosticReview_requestKey_key" ON "DiagnosticReview"("requestKey");
CREATE UNIQUE INDEX "DiagnosticReview_one_acknowledgement" ON "DiagnosticReview"("orderId") WHERE "action" = 'ACKNOWLEDGE';
CREATE TRIGGER "DiagnosticReview_immutable" BEFORE UPDATE OR DELETE ON "DiagnosticReview"
FOR EACH ROW EXECUTE FUNCTION prevent_referral_clinical_event_mutation();
