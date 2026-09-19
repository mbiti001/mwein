CREATE TABLE "VisitCancellation" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "visitId" UUID NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "shaOutcome" TEXT,
  "shaEligibilityReference" TEXT,
  "policyVersion" TEXT,
  "cancelledById" UUID NOT NULL,
  "cancelledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitCancellation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisitCancellation_reasonCode_check" CHECK ("reasonCode" IN (
    'PATIENT_REQUEST', 'PATIENT_LEFT_BEFORE_CARE', 'DUPLICATE_VISIT', 'WRONG_PATIENT',
    'CLINIC_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'CLINICAL_REDIRECTION',
    'SHA_BENEFIT_OR_ELIGIBILITY', 'PRIVATE_COVER_NOT_AVAILABLE', 'CREATED_IN_ERROR', 'OTHER'
  )),
  CONSTRAINT "VisitCancellation_shaOutcome_check" CHECK ("shaOutcome" IS NULL OR "shaOutcome" IN (
    'COVERAGE_INACTIVE', 'BENEFIT_NOT_COVERED', 'BENEFIT_LIMIT_REACHED', 'WAITING_PERIOD',
    'REFERRAL_REQUIRED', 'PRIOR_AUTHORIZATION_REQUIRED', 'NETWORK_RESTRICTION', 'VERIFICATION_UNAVAILABLE'
  )),
  CONSTRAINT "VisitCancellation_shaEvidence_check" CHECK (
    ("reasonCode" = 'SHA_BENEFIT_OR_ELIGIBILITY' AND "shaOutcome" IS NOT NULL AND "shaEligibilityReference" IS NOT NULL AND "policyVersion" IS NOT NULL)
    OR
    ("reasonCode" <> 'SHA_BENEFIT_OR_ELIGIBILITY' AND "shaOutcome" IS NULL AND "shaEligibilityReference" IS NULL AND "policyVersion" IS NULL)
  )
);

CREATE UNIQUE INDEX "VisitCancellation_visitId_key" ON "VisitCancellation"("visitId");
CREATE INDEX "VisitCancellation_facilityId_cancelledAt_idx" ON "VisitCancellation"("facilityId", "cancelledAt");

ALTER TABLE "VisitCancellation" ADD CONSTRAINT "VisitCancellation_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitCancellation" ADD CONSTRAINT "VisitCancellation_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitCancellation" ADD CONSTRAINT "VisitCancellation_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "code", "description")
VALUES (gen_random_uuid(), 'visit.cancel', 'Cancel visits with a documented reason')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" AS role
CROSS JOIN "Permission" AS permission
WHERE role."code" IN ('SYSTEM_ADMIN', 'RECEPTION', 'BILLING', 'FINANCE_MANAGER', 'FACILITY_ADMIN')
  AND permission."code" = 'visit.cancel'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
