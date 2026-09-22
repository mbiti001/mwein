import { randomUUID } from "node:crypto";
import { appendAudit, auditEntitySetFingerprint, auditValueFingerprint } from "./audit";
import { db } from "./db";

type Actor = { id: string; facilityId: string; sessionId: string };
export type DisclosureContext = "APPOINTMENTS" | "DISPENSING_DETAILS" | "PATIENT_PROBLEMS" | "REFERRALS" | "MONTHLY_REPORT" | "OPERATIONS_REPORT";

// Do not retain query text, patient identifiers or report values in the audit record.
// Await this before returning data: an audit failure must prevent disclosure.
export async function recordDisclosure(actor: Actor, context: DisclosureContext, ids: string[], report?: unknown) {
  await db.$transaction(tx => appendAudit(tx, {
    facilityId: actor.facilityId, userId: actor.id, sessionId: actor.sessionId,
    action: "SENSITIVE_DATA_ACCESSED", entityType: "Disclosure", entityId: randomUUID(),
    reason: context, afterHash: report === undefined ? auditEntitySetFingerprint(ids) : auditValueFingerprint(report),
  }));
}
