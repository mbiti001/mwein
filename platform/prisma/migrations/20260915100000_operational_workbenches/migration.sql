ALTER TABLE "ServicePointControl" ADD COLUMN "targetMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "ServicePointControl" ADD CONSTRAINT "ServicePointControl_targetMinutes" CHECK ("targetMinutes" BETWEEN 5 AND 480);

CREATE TABLE "CashierShift" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "cashierId" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "openingFloat" DECIMAL(14,2) NOT NULL,
  "expectedCash" DECIMAL(14,2),
  "countedCash" DECIMAL(14,2),
  "variance" DECIMAL(14,2),
  "varianceReason" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "approvedById" UUID,
  CONSTRAINT "CashierShift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashierShift_status" CHECK ("status" IN ('OPEN', 'SUBMITTED', 'APPROVED')),
  CONSTRAINT "CashierShift_openingFloat" CHECK ("openingFloat" >= 0),
  CONSTRAINT "CashierShift_submission" CHECK (("status" = 'OPEN' AND "submittedAt" IS NULL AND "countedCash" IS NULL AND "variance" IS NULL) OR ("status" <> 'OPEN' AND "submittedAt" IS NOT NULL AND "countedCash" IS NOT NULL AND "variance" IS NOT NULL)),
  CONSTRAINT "CashierShift_approval" CHECK (("status" <> 'APPROVED') OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL))
);
CREATE UNIQUE INDEX "CashierShift_cashier_active_key" ON "CashierShift"("cashierId") WHERE "status" IN ('OPEN', 'SUBMITTED');
CREATE INDEX "CashierShift_facilityId_status_openedAt_idx" ON "CashierShift"("facilityId", "status", "openedAt");
CREATE INDEX "CashierShift_cashierId_openedAt_idx" ON "CashierShift"("cashierId", "openedAt");
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD COLUMN "cashierShiftId" UUID;
CREATE INDEX "Payment_cashierShiftId_receivedAt_idx" ON "Payment"("cashierShiftId", "receivedAt");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashierShiftId_fkey" FOREIGN KEY ("cashierShiftId") REFERENCES "CashierShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OperationsEvidence" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "evidenceReference" TEXT,
  "notes" TEXT,
  "recordedById" UUID NOT NULL,
  "verifiedById" UUID,
  "verifiedAt" TIMESTAMP(3),
  "nextReviewAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationsEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationsEvidence_kind" CHECK ("kind" IN ('BACKUP', 'RESTORE_DRILL', 'AUDIT_EXPORT', 'INCIDENT', 'DOWNTIME_REHEARSAL')),
  CONSTRAINT "OperationsEvidence_status" CHECK ("status" IN ('SUCCESS', 'FAILURE', 'OPEN', 'RESOLVED')),
  CONSTRAINT "OperationsEvidence_verification" CHECK (("verifiedById" IS NULL AND "verifiedAt" IS NULL) OR ("verifiedById" IS NOT NULL AND "verifiedAt" IS NOT NULL))
);
CREATE INDEX "OperationsEvidence_facilityId_kind_occurredAt_idx" ON "OperationsEvidence"("facilityId", "kind", "occurredAt");
CREATE INDEX "OperationsEvidence_facilityId_status_verifiedAt_idx" ON "OperationsEvidence"("facilityId", "status", "verifiedAt");
ALTER TABLE "OperationsEvidence" ADD CONSTRAINT "OperationsEvidence_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationsEvidence" ADD CONSTRAINT "OperationsEvidence_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationsEvidence" ADD CONSTRAINT "OperationsEvidence_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
