// Financial settlement can remain outstanding after clinical care closes.
export function isOpenClinicalVisit(visit: { status: string; clinicallyClosedAt?: string | Date | null }) {
  return !visit.clinicallyClosedAt && !["COMPLETED", "CANCELLED", "DISCHARGED"].includes(visit.status);
}
