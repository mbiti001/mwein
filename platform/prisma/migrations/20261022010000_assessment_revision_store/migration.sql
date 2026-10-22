-- Storage foundation only. API capture/disclosure must be integrated before release.
-- Never reconstruct historical values or sessions from audit digests.
BEGIN;

-- Composite keys bind every retained snapshot to the actual record context.
CREATE UNIQUE INDEX "ServicePointRecord_id_encounterId_key" ON "ServicePointRecord"("id", "encounterId");
CREATE UNIQUE INDEX "Encounter_id_visitId_key" ON "Encounter"("id", "visitId");
CREATE UNIQUE INDEX "Visit_id_facilityId_key" ON "Visit"("id", "facilityId");

CREATE TABLE "ServicePointRevision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recordId" UUID NOT NULL,
  "encounterId" UUID NOT NULL,
  "visitId" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "previousVersion" INTEGER,
  "kind" TEXT NOT NULL,
  "servicePoint" TEXT NOT NULL,
  "templateVersion" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "riskLevel" TEXT,
  "followUpAt" DATE,
  "recordedById" UUID NOT NULL,
  -- Opaque authenticated-session evidence, like AuditEvent.sessionId: no FK
  -- to an expiring session row. Capture is the future authorized writer's job.
  "sessionId" UUID,
  "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServicePointRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServicePointRevision_recordId_version_key" UNIQUE ("recordId", "version"),
  CONSTRAINT "ServicePointRevision_order_check" CHECK (
    ("version" = 1 AND "previousVersion" IS NULL) OR
    ("version" > 1 AND "previousVersion" IS NOT NULL AND "previousVersion" = "version" - 1)
  ),
  CONSTRAINT "ServicePointRevision_kind_check" CHECK (
    ("kind" = 'MIGRATION_BASELINE' AND "version" = 1 AND "sessionId" IS NULL) OR
    ("kind" = 'DRAFT_SAVE' AND "sessionId" IS NOT NULL)
  ),
  CONSTRAINT "ServicePointRevision_data_check" CHECK (jsonb_typeof("data") = 'object'),
  CONSTRAINT "ServicePointRevision_record_context_fkey" FOREIGN KEY ("recordId", "encounterId")
    REFERENCES "ServicePointRecord"("id", "encounterId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ServicePointRevision_encounter_context_fkey" FOREIGN KEY ("encounterId", "visitId")
    REFERENCES "Encounter"("id", "visitId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ServicePointRevision_visit_context_fkey" FOREIGN KEY ("visitId", "facilityId")
    REFERENCES "Visit"("id", "facilityId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ServicePointRevision_recordedById_fkey" FOREIGN KEY ("recordedById")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ServicePointRevision_predecessor_fkey" FOREIGN KEY ("recordId", "previousVersion")
    REFERENCES "ServicePointRevision"("recordId", "version") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "ServicePointRevision_facilityId_visitId_capturedAt_idx"
  ON "ServicePointRevision"("facilityId", "visitId", "capturedAt");

-- Locks stop concurrent changes between the legacy snapshot and baseline capture.
LOCK TABLE "ServicePointRecord", "Encounter", "Visit" IN SHARE MODE;
INSERT INTO "ServicePointRevision" (
  "recordId", "encounterId", "visitId", "facilityId", "version", "kind",
  "servicePoint", "templateVersion", "data", "riskLevel", "followUpAt",
  "recordedById", "sourceCreatedAt", "sourceUpdatedAt"
)
SELECT r."id", r."encounterId", e."visitId", v."facilityId", 1, 'MIGRATION_BASELINE',
  r."servicePoint", r."templateVersion", r."data", r."riskLevel", r."followUpAt",
  r."updatedById", r."createdAt", r."updatedAt"
FROM "ServicePointRecord" r
JOIN "Encounter" e ON e."id" = r."encounterId"
JOIN "Visit" v ON v."id" = e."visitId";

CREATE FUNCTION prevent_service_point_revision_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ServicePointRevision records are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ServicePointRevision_immutable"
  BEFORE UPDATE OR DELETE ON "ServicePointRevision"
  FOR EACH ROW EXECUTE FUNCTION prevent_service_point_revision_mutation();
CREATE TRIGGER "ServicePointRevision_no_truncate"
  BEFORE TRUNCATE ON "ServicePointRevision"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_service_point_revision_mutation();
REVOKE ALL ON "ServicePointRevision" FROM PUBLIC;

COMMIT;
