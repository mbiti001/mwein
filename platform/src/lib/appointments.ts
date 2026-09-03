export const appointmentClinics = [
  "Outpatient",
  "ANC",
  "HTN",
  "DM",
  "Paediatrics",
  "Emergency",
  "Other",
] as const;

export function appointmentCanBeBooked(scheduledAt: Date, now = new Date()) {
  const delay = scheduledAt.getTime() - now.getTime();
  return Number.isFinite(delay) && delay > 0 && delay <= 90 * 24 * 60 * 60 * 1000;
}
