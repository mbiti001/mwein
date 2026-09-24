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
  clinicallyClosedAt?: string | null;
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

export function activeServiceTasks(visit: FlowVisit, now = new Date()) {
  if (["COMPLETED", "CANCELLED"].includes(visit.status)) return [];
  const closed = Boolean(visit.clinicallyClosedAt) || visit.status === "DISCHARGED";
  const queues = (visit.queues || []).filter(queue =>
    ["WAITING", "CALLED", "IN_PROGRESS"].includes(queue.status) &&
    servicePoints.some(point => point.code === queue.servicePoint) &&
    (!closed || queue.servicePoint === "BILLING"));
  const points = new Map<ServicePointCode, { point: ServicePointCode; status: string; enteredAt: string }>();
  for (const queue of queues) {
    const point = queue.servicePoint as ServicePointCode;
    const enteredAt = queue.enteredAt || visit.arrivedAt;
    const existing = points.get(point);
    // Duplicate active entries represent one department task; retain the oldest wait.
    if (!existing || new Date(enteredAt).getTime() < new Date(existing.enteredAt).getTime())
      points.set(point, { point, status: queue.status, enteredAt });
  }
  if (!points.size && !closed) {
    const point = statusServicePoint[visit.status];
    if (point) points.set(point, { point, status: visit.status === "UNDER_CONSULTATION" ? "IN_PROGRESS" : "WAITING", enteredAt: visit.arrivedAt });
  }
  return [...points.values()].map(task => {
    const elapsed = Math.floor((now.getTime() - new Date(task.enteredAt).getTime()) / 60000);
    return { ...task, wait: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0 };
  });
}

export function currentServicePoint(visit: FlowVisit): ServicePointCode | null {
  return activeServiceTasks(visit)[0]?.point || null;
}

export function servicePointCounts(visits: FlowVisit[]) {
  return Object.fromEntries(servicePoints.map(point => [point.code,
    visits.filter(visit => activeServiceTasks(visit).some(task => task.point === point.code)).length,
  ])) as Record<ServicePointCode, number>;
}

export function waitingMinutes(visit: FlowVisit, now = new Date()) {
  return activeServiceTasks(visit, now)[0]?.wait || 0;
}

export function isWaitingOverdue(priority: string, minutes: number, targetMinutes = 30) {
  const threshold = priority === "EMERGENCY" ? 1 : priority === "URGENT" ? Math.max(5, Math.floor(targetMinutes / 3)) : priority === "PRIORITY" ? Math.max(10, Math.floor(targetMinutes * 2 / 3)) : targetMinutes;
  return minutes >= threshold;
}
