export const consentTypes = ["TREATMENT", "ELECTRONIC_RECORD", "MESSAGING", "DATA_EXCHANGE", "RESEARCH"] as const;
export const consentMethods = ["WRITTEN", "ELECTRONIC", "VERBAL_WITNESSED"] as const;
export const dataSubjectRequestTypes = ["ACCESS", "CORRECTION", "PORTABLE_EXPORT", "DISCLOSURE"] as const;
export const dataSubjectRequestStatuses = ["RECEIVED", "IDENTITY_VERIFIED", "IN_REVIEW", "COMPLETED", "DENIED", "CANCELLED"] as const;

export type DataSubjectRequestStatus = typeof dataSubjectRequestStatuses[number];
export type DataSubjectRequestType = typeof dataSubjectRequestTypes[number];

// Operational ceilings from General Regulations 2021, rr. 9(4), 10(4), 11(3).
// DISCLOSURE is a local triage target, not a statutory response period.
export const rightsRequestPolicy = {
  ACCESS: { days: 7, label: "Access response · 7 days" },
  CORRECTION: { days: 14, label: "Correction review/action · 14 days" },
  PORTABLE_EXPORT: { days: 30, label: "Portability response · 30 days" },
  DISCLOSURE: { days: 7, label: "Disclosure triage · internal 7-day target" },
} satisfies Record<DataSubjectRequestType, { days: number; label: string }>;

export function rightsRequestDueAt(type: DataSubjectRequestType, receivedAt: Date) {
  // Elapsed days: no weekend extension, clock reset on verification, or client override.
  return new Date(receivedAt.getTime() + rightsRequestPolicy[type].days * 86_400_000);
}

export function rightsRequestIsOverdue(status: string, dueAt: string, now = new Date()) {
  return !["COMPLETED", "DENIED", "CANCELLED"].includes(status) && new Date(dueAt) < now;
}

const transitions: Record<DataSubjectRequestStatus, DataSubjectRequestStatus[]> = {
  RECEIVED: ["IDENTITY_VERIFIED", "DENIED", "CANCELLED"],
  IDENTITY_VERIFIED: ["IN_REVIEW", "DENIED", "CANCELLED"],
  IN_REVIEW: ["COMPLETED", "DENIED", "CANCELLED"],
  COMPLETED: [],
  DENIED: [],
  CANCELLED: [],
};

export function canTransitionDataSubjectRequest(from: DataSubjectRequestStatus, to: DataSubjectRequestStatus) {
  return transitions[from].includes(to);
}
