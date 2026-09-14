import type { Priority } from "@prisma/client";

export const operationalServicePoints = [
  "TRIAGE",
  "CONSULTATION",
  "LABORATORY",
  "IMAGING",
  "PHARMACY",
  "BILLING",
] as const;

export type OperationalServicePoint = (typeof operationalServicePoints)[number];

export const servicePointPermission: Record<OperationalServicePoint, string> = {
  TRIAGE: "triage.write",
  CONSULTATION: "encounter.write",
  LABORATORY: "laboratory.write",
  IMAGING: "imaging.write",
  PHARMACY: "pharmacy.dispense",
  BILLING: "billing.write",
};

export const servicePointVisitStatus: Record<OperationalServicePoint, string> = {
  TRIAGE: "AWAITING_TRIAGE",
  CONSULTATION: "AWAITING_CLINICIAN",
  LABORATORY: "AWAITING_RESULTS",
  IMAGING: "AWAITING_RESULTS",
  PHARMACY: "AWAITING_PHARMACY",
  BILLING: "AWAITING_PAYMENT",
};

const priorityRank: Record<Priority, number> = {
  EMERGENCY: 0,
  URGENT: 1,
  PRIORITY: 2,
  ROUTINE: 3,
};

export function queueSortValue(priority: Priority, enteredAt: Date | string) {
  return priorityRank[priority] * 10_000_000_000_000 + new Date(enteredAt).getTime();
}

export function queueDurationMinutes(enteredAt: Date | string, endedAt: Date | string) {
  return Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(enteredAt).getTime()) / 60_000));
}

export function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}
