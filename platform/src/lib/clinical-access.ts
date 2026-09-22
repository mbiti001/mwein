import { randomUUID } from "node:crypto";
import { appendAudit } from "./audit";
import { db } from "./db";

type Actor = { id: string; facilityId: string; sessionId: string };
type Resource = {
  type: "Patient" | "Visit" | "LaboratoryResult" | "ImagingResult";
  id: string;
};
type AccessContext = "PATIENT_SEARCH" | "PATIENT_HISTORY" | "PATIENT_CONSENTS" | "VISIT_SUMMARIES" | "CLINICAL_RESULT" | "VISIT_WORKLIST";

/** Record the authorised disclosure before returning it. Never log search terms or clinical content.
 * A single event covers the response's resource set, avoiding one chain lock per list item.
 * This proves server-side access was authorised, not that a browser rendered/printed the record.
 */
export async function recordClinicalAccess(actor: Actor, context: AccessContext, resources: Resource[]) {
  const references = [...new Map(resources.map(({ type, id }) => [`${type}:${id}`, { type, id }])).values()];
  await db.$transaction(async (tx) => appendAudit(tx, {
    facilityId: actor.facilityId,
    userId: actor.id,
    sessionId: actor.sessionId,
    action: "CLINICAL_RECORDS_ACCESSED",
    entityType: references.length === 1 ? references[0].type : "ClinicalRecordSet",
    entityId: references.length === 1 ? references[0].id : randomUUID(),
    reason: JSON.stringify({ version: 1, context, outcome: "AUTHORISED_DISCLOSURE", resources: references }),
  }));
}
