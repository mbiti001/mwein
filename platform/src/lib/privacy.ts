export const consentTypes = ["TREATMENT", "ELECTRONIC_RECORD", "MESSAGING", "DATA_EXCHANGE", "RESEARCH"] as const;
export const consentMethods = ["WRITTEN", "ELECTRONIC", "VERBAL_WITNESSED"] as const;
export const dataSubjectRequestTypes = ["ACCESS", "CORRECTION", "PORTABLE_EXPORT", "DISCLOSURE"] as const;
export const dataSubjectRequestStatuses = ["RECEIVED", "IDENTITY_VERIFIED", "IN_REVIEW", "COMPLETED", "DENIED", "CANCELLED"] as const;

export type DataSubjectRequestStatus = typeof dataSubjectRequestStatuses[number];

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
