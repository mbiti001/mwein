CREATE TABLE "AiGeneration" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "visitId" UUID NOT NULL,
  "requestedById" UUID NOT NULL,
  "reviewedById" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'VISIT_SUMMARY',
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "providerResponseId" TEXT,
  "inputHash" TEXT NOT NULL,
  "outputHash" TEXT,
  "reviewedOutputHash" TEXT,
  "draft" JSONB,
  "reviewedDraft" JSONB,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "totalTokens" INTEGER,
  "latencyMs" INTEGER,
  "failureCode" TEXT,
  "dataGovernanceReference" TEXT NOT NULL,
  "clinicalSafetyReference" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiGeneration_purpose" CHECK ("purpose" = 'VISIT_SUMMARY'),
  CONSTRAINT "AiGeneration_model" CHECK ("model" = 'gpt-6-astra'),
  CONSTRAINT "AiGeneration_status" CHECK ("status" IN ('REQUESTED', 'GENERATED', 'ACCEPTED', 'DISCARDED', 'FAILED')),
  CONSTRAINT "AiGeneration_completed_state" CHECK (
    ("status" = 'REQUESTED' AND "completedAt" IS NULL)
    OR ("status" <> 'REQUESTED' AND "completedAt" IS NOT NULL)
  ),
  CONSTRAINT "AiGeneration_review_state" CHECK (
    ("status" IN ('ACCEPTED', 'DISCARDED') AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL)
    OR ("status" NOT IN ('ACCEPTED', 'DISCARDED') AND "reviewedById" IS NULL AND "reviewedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "AiGeneration_idempotencyKey_key" ON "AiGeneration"("idempotencyKey");
CREATE INDEX "AiGeneration_facilityId_createdAt_idx" ON "AiGeneration"("facilityId", "createdAt");
CREATE INDEX "AiGeneration_visitId_createdAt_idx" ON "AiGeneration"("visitId", "createdAt");
CREATE INDEX "AiGeneration_requestedById_status_createdAt_idx" ON "AiGeneration"("requestedById", "status", "createdAt");

ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
