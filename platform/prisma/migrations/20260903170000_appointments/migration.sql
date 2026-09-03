CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

CREATE TABLE "Appointment" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "clinic" TEXT NOT NULL,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
  "notes" TEXT,
  "reminderPreparedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Visit" ADD COLUMN "appointmentId" UUID;
CREATE UNIQUE INDEX "Visit_appointmentId_key" ON "Visit"("appointmentId");
CREATE UNIQUE INDEX "Appointment_facilityId_patientId_scheduledAt_key" ON "Appointment"("facilityId", "patientId", "scheduledAt");
CREATE INDEX "Appointment_facilityId_status_scheduledAt_idx" ON "Appointment"("facilityId", "status", "scheduledAt");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
