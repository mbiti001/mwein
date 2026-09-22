-- CreateTable
CREATE TABLE "SurveillanceRecord" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "patientId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'UNASSESSED',
    "details" JSONB NOT NULL,
    "duplicateOfId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveillanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveillanceEntry" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "evidence" JSONB,
    "snapshotHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveillanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SurveillanceRecord_facilityId_status_updatedAt_idx" ON "SurveillanceRecord"("facilityId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SurveillanceEntry_recordId_version_key" ON "SurveillanceEntry"("recordId", "version");

-- AddForeignKey
ALTER TABLE "SurveillanceRecord" ADD CONSTRAINT "SurveillanceRecord_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveillanceRecord" ADD CONSTRAINT "SurveillanceRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveillanceRecord" ADD CONSTRAINT "SurveillanceRecord_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "SurveillanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveillanceEntry" ADD CONSTRAINT "SurveillanceEntry_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "SurveillanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveillanceEntry" ADD CONSTRAINT "SurveillanceEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SurveillanceRecord" ADD CONSTRAINT "SurveillanceRecord_status" CHECK ("status" IN ('OPEN', 'REVIEWED', 'CLOSED'));
ALTER TABLE "SurveillanceRecord" ADD CONSTRAINT "SurveillanceRecord_priority" CHECK ("priority" IN ('UNASSESSED', 'URGENT', 'ROUTINE'));
ALTER TABLE "SurveillanceRecord" ADD CONSTRAINT "SurveillanceRecord_version" CHECK ("version" > 0);
ALTER TABLE "SurveillanceRecord" ADD CONSTRAINT "SurveillanceRecord_not_self_duplicate" CHECK ("duplicateOfId" IS NULL OR "duplicateOfId" <> "id");
CREATE FUNCTION protect_surveillance_history() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Surveillance history is immutable; append a correction note';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SurveillanceEntry_immutable" BEFORE UPDATE OR DELETE ON "SurveillanceEntry"
FOR EACH ROW EXECUTE FUNCTION protect_surveillance_history();
