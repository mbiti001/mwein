ALTER TABLE "TriageRecord" ADD COLUMN "estimatedDeliveryDate" DATE;
ALTER TABLE "TriageRecord" ADD COLUMN "gestationalAgeWeeks" INTEGER;
ALTER TABLE "TriageRecord" ADD COLUMN "gestationalAgeDays" INTEGER;
ALTER TABLE "TriageRecord" ADD COLUMN "pregnancyDatingMethod" TEXT;

ALTER TABLE "TriageRecord" ADD CONSTRAINT "TriageRecord_gestationalAgeWeeks" CHECK ("gestationalAgeWeeks" IS NULL OR "gestationalAgeWeeks" >= 0);
ALTER TABLE "TriageRecord" ADD CONSTRAINT "TriageRecord_gestationalAgeDays" CHECK ("gestationalAgeDays" IS NULL OR "gestationalAgeDays" BETWEEN 0 AND 6);
ALTER TABLE "TriageRecord" ADD CONSTRAINT "TriageRecord_pregnancyDatingMethod" CHECK ("pregnancyDatingMethod" IS NULL OR "pregnancyDatingMethod" IN ('LNMP', 'ULTRASOUND', 'CLINICAL_ESTIMATE'));
