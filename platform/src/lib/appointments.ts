import { careClinicNames } from "./care-service-points";

export const appointmentClinics = careClinicNames;
export const appointmentScopes = ["today", "upcoming", "recall", "all"] as const;
export type AppointmentScope = (typeof appointmentScopes)[number];

export function kenyaDayStart(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${date}T00:00:00+03:00`);
}

export function appointmentWindow(scope: AppointmentScope, now = new Date()) {
  const today = kenyaDayStart(now);
  const day = 86_400_000;
  if (scope === "today") return { gte: today, lt: new Date(today.getTime() + day) };
  if (scope === "upcoming") return { gte: new Date(today.getTime() + day), lt: new Date(today.getTime() + 31 * day) };
  if (scope === "recall") return { gte: new Date(today.getTime() - 90 * day), lt: now };
  return { gte: new Date(today.getTime() - 90 * day), lt: new Date(today.getTime() + 91 * day) };
}

export function kenyaAppointmentInput(now = new Date()) {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 16);
}

export function appointmentCanBeBooked(scheduledAt: Date, now = new Date()) {
  const delay = scheduledAt.getTime() - now.getTime();
  return Number.isFinite(delay) && delay > 0 && delay <= 90 * 24 * 60 * 60 * 1000;
}
