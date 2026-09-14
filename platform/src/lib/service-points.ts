export const servicePoints = [
  { code: "TRIAGE", label: "Triage", screen: "triage", next: "Consultation" },
  { code: "CONSULTATION", label: "Consultation", screen: "consultation", next: "Diagnostics, pharmacy or billing" },
  { code: "LABORATORY", label: "Laboratory", screen: "diagnostics", next: "Consultation review" },
  { code: "IMAGING", label: "Imaging", screen: "imaging", next: "Consultation review" },
  { code: "PHARMACY", label: "Pharmacy", screen: "pharmacy", next: "Billing" },
  { code: "BILLING", label: "Billing", screen: "billing", next: "Visit completion" },
] as const;

export type ServicePointCode = (typeof servicePoints)[number]["code"];

export type FlowVisit = {
  id: string;
  status: string;
  priority: string;
  arrivedAt: string;
  patient: { fullName: string; patientNumber: string };
  queues?: { servicePoint: string; status: string; enteredAt?: string }[];
};

const statusServicePoint: Record<string, ServicePointCode> = {
  AWAITING_TRIAGE: "TRIAGE",
  AWAITING_CLINICIAN: "CONSULTATION",
  UNDER_CONSULTATION: "CONSULTATION",
  ORDERS_PENDING: "CONSULTATION",
  AWAITING_RESULTS: "LABORATORY",
  AWAITING_PHARMACY: "PHARMACY",
  AWAITING_PAYMENT: "BILLING",
};

export function currentServicePoint(visit: FlowVisit): ServicePointCode | null {
  const activeQueue = visit.queues?.find((queue) => ["WAITING", "CALLED", "IN_PROGRESS"].includes(queue.status));
  if (activeQueue && servicePoints.some((point) => point.code === activeQueue.servicePoint))
    return activeQueue.servicePoint as ServicePointCode;
  return statusServicePoint[visit.status] || null;
}

export function servicePointCounts(visits: FlowVisit[]) {
  return Object.fromEntries(
    servicePoints.map((point) => [point.code, visits.filter((visit) => currentServicePoint(visit) === point.code).length]),
  ) as Record<ServicePointCode, number>;
}

export function waitingMinutes(visit: FlowVisit, now = new Date()) {
  const enteredAt = visit.queues?.[0]?.enteredAt || visit.arrivedAt;
  return Math.max(0, Math.floor((now.getTime() - new Date(enteredAt).getTime()) / 60000));
}

export function isWaitingOverdue(priority: string, minutes: number, targetMinutes = 30) {
  const threshold = priority === "EMERGENCY" ? 1 : priority === "URGENT" ? Math.max(5, Math.floor(targetMinutes / 3)) : priority === "PRIORITY" ? Math.max(10, Math.floor(targetMinutes * 2 / 3)) : targetMinutes;
  return minutes >= threshold;
}
