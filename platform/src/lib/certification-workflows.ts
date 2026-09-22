import { createHash } from "node:crypto";

export const patientRightsTypes = ["ACCESS", "CORRECTION", "RESTRICTION", "PORTABILITY", "OBJECTION"] as const;
export const patientRightsStatuses = ["RECEIVED", "IN_REVIEW", "WAITING_FOR_PATIENT", "COMPLETED", "DENIED", "CANCELLED"] as const;
export const exchangeChannels = ["DHA_FHIR", "PUBLIC_HEALTH"] as const;

export function rightsRequestDueAt(createdAt = new Date(), calendarDays = 30) {
  const due = new Date(createdAt);
  due.setUTCDate(due.getUTCDate() + calendarDays);
  return due;
}

export function canTransitionRightsRequest(from: string, to: string) {
  const transitions: Record<string, string[]> = {
    RECEIVED: ["IN_REVIEW", "CANCELLED"],
    IN_REVIEW: ["WAITING_FOR_PATIENT", "COMPLETED", "DENIED", "CANCELLED"],
    WAITING_FOR_PATIENT: ["IN_REVIEW", "COMPLETED", "DENIED", "CANCELLED"],
    COMPLETED: [], DENIED: [], CANCELLED: [],
  };
  return Boolean(transitions[from]?.includes(to));
}

export function requiresRightsOutcome(status: string) {
  return ["COMPLETED", "DENIED"].includes(status);
}

export function stablePayloadHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function exchangeRetryAt(attemptCount: number, now = new Date()) {
  const minutes = Math.min(24 * 60, 2 ** Math.max(0, attemptCount) * 5);
  return new Date(now.getTime() + minutes * 60_000);
}

export function exchangeTransportConfiguration(channel: typeof exchangeChannels[number], environment: Record<string, string | undefined> = process.env) {
  const prefix = channel === "DHA_FHIR" ? "DHA_FHIR" : "PUBLIC_HEALTH";
  const endpoint = environment[`${prefix}_ENDPOINT`]?.trim() || "";
  const token = environment[`${prefix}_ACCESS_TOKEN`]?.trim() || "";
  const enabled = environment[`${prefix}_TRANSPORT_ENABLED`] === "true";
  return { enabled, endpoint, token, ready: enabled && endpoint.startsWith("https://") && token.length >= 16 };
}
