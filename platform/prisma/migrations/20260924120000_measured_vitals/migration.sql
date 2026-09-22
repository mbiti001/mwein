-- AlterTable
ALTER TABLE "TriageRecord" ADD COLUMN     "reviewedVitalsId" UUID;

-- CreateTable
CREATE TABLE "MeasuredVitals" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "recordedById" UUID NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "values" JSONB NOT NULL,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasuredVitals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeasuredVitals_visitId_recordedAt_idx" ON "MeasuredVitals"("visitId", "recordedAt");

-- AddForeignKey
ALTER TABLE "TriageRecord" ADD CONSTRAINT "TriageRecord_reviewedVitalsId_fkey" FOREIGN KEY ("reviewedVitalsId") REFERENCES "MeasuredVitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasuredVitals" ADD CONSTRAINT "MeasuredVitals_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasuredVitals" ADD CONSTRAINT "MeasuredVitals_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE FUNCTION protect_measured_vitals() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Measured vitals are immutable; record a new measurement with a correction note';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MeasuredVitals_immutable" BEFORE UPDATE OR DELETE ON "MeasuredVitals"
FOR EACH ROW EXECUTE FUNCTION protect_measured_vitals();
