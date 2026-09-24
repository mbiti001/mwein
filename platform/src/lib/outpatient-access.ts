import { randomUUID } from "node:crypto";
import { appendAudit, auditEntitySetFingerprint } from "./audit";
import { db } from "./db";

type Actor = { id: string; facilityId: string; sessionId: string };
type Context = "APPOINTMENT_LIST" | "PATIENT_PROBLEM_LIST" | "REFERRAL_LIST" | "DISPENSING_PREVIEW";

/** Persist bounded disclosure evidence before returning data, including empty lists.
 * Fingerprints identify the returned set without duplicating patient data in metadata.
 * Audit failures propagate to the route so disclosure fails closed.
 */
export async function recordOutpatientAccess(actor: Actor, context: Context, resourceIds: string[]) {
  await db.$transaction(async (tx) => appendAudit(tx, {
    facilityId: actor.facilityId,
    userId: actor.id,
    sessionId: actor.sessionId,
    action: "CLINICAL_RECORDS_ACCESSED",
    entityType: "ClinicalRecordSet",
    entityId: randomUUID(),
    afterHash: auditEntitySetFingerprint(resourceIds),
    reason: JSON.stringify({ version: 1, context, outcome: "AUTHORISED_DISCLOSURE" }),
  }));
}

export function privateResponse<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
