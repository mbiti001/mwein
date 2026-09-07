import { careClinicNames } from "./care-service-points";

export const appointmentClinics = careClinicNames;

export function appointmentCanBeBooked(scheduledAt: Date, now = new Date()) {
  const delay = scheduledAt.getTime() - now.getTime();
  return Number.isFinite(delay) && delay > 0 && delay <= 90 * 24 * 60 * 60 * 1000;
}
