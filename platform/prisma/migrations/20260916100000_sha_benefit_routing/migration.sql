ALTER TABLE "Claim"
  ADD COLUMN "fundCode" TEXT,
  ADD COLUMN "eligibilityVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "facilityServiceApproved" BOOLEAN,
  ADD COLUMN "authorizationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "authorizationReference" TEXT,
  ADD COLUMN "serviceDate" TIMESTAMP(3),
  ADD COLUMN "submissionDeadline" TIMESTAMP(3);

CREATE INDEX "Claim_fundCode_status_submissionDeadline_idx"
  ON "Claim"("fundCode", "status", "submissionDeadline");

ALTER TYPE "ClaimStatus" ADD VALUE 'RETURNED' AFTER 'SUBMITTED';
ALTER TYPE "ClaimStatus" ADD VALUE 'REDUCED' AFTER 'APPROVED';
ALTER TYPE "ClaimStatus" ADD VALUE 'UNDER_REVIEW' AFTER 'REJECTED';
ALTER TYPE "ClaimStatus" ADD VALUE 'WITHHELD' AFTER 'UNDER_REVIEW';
ALTER TYPE "ClaimStatus" ADD VALUE 'RECOVERED' AFTER 'PAID';

ALTER TABLE "Payment" ADD COLUMN "coverageConsentReference" TEXT;
