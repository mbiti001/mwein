import { createHash } from "node:crypto";

type ClosureState = { id: string; status: string; clinicallyClosedAt: Date | null; encounters: { id: string; status: string }[]; orders: { id: string; status: string }[] };
export function dischargeRevision(visit: ClosureState) {
  const records = (items: { id: string; status: string }[]) => items.map(item => `${item.id}:${item.status}`).sort();
  return createHash("sha256").update(JSON.stringify([visit.id, visit.status, visit.clinicallyClosedAt, records(visit.encounters), records(visit.orders)])).digest("hex");
}
export function dischargeRequestFingerprint(input: { outcome: string; details: string; cancelPendingOrders: boolean; expectedRevision?: string }) {
  return createHash("sha256").update(JSON.stringify([input.outcome, input.details, input.cancelPendingOrders, input.expectedRevision || null])).digest("hex");
}
