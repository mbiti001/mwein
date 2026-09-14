CREATE TABLE "AncAdmissionEvidence" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "visitId" UUID NOT NULL,
  "result" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "testedAt" DATE NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "consentConfirmed" BOOLEAN NOT NULL,
  "safeguardingReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "recordedById" UUID NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AncAdmissionEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AncAdmissionEvidence_positive_result" CHECK ("result" = 'POSITIVE'),
  CONSTRAINT "AncAdmissionEvidence_method" CHECK ("method" IN ('FACILITY_LAB', 'EXTERNAL_LAB')),
  CONSTRAINT "AncAdmissionEvidence_consent" CHECK ("consentConfirmed" = true),
  CONSTRAINT "AncAdmissionEvidence_reference" CHECK (char_length(trim("evidenceReference")) >= 3)
);

CREATE UNIQUE INDEX "AncAdmissionEvidence_visitId_key" ON "AncAdmissionEvidence"("visitId");
CREATE INDEX "AncAdmissionEvidence_facilityId_safeguardingReviewRequired_recordedAt_idx" ON "AncAdmissionEvidence"("facilityId", "safeguardingReviewRequired", "recordedAt");

ALTER TABLE "AncAdmissionEvidence" ADD CONSTRAINT "AncAdmissionEvidence_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AncAdmissionEvidence" ADD CONSTRAINT "AncAdmissionEvidence_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AncAdmissionEvidence" ADD CONSTRAINT "AncAdmissionEvidence_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_anc_admission_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ANC admission evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AncAdmissionEvidence_immutable"
BEFORE UPDATE OR DELETE ON "AncAdmissionEvidence"
FOR EACH ROW EXECUTE FUNCTION prevent_anc_admission_evidence_mutation();
