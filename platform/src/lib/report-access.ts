import { randomUUID } from "node:crypto";
import { appendAudit, auditValueFingerprint } from "./audit";
import { db } from "./db";

type Actor = { id: string; facilityId: string; sessionId: string };
/** Fingerprint the generated response; never duplicate clinical/financial data in audit metadata. */
export async function recordReportAccess(actor: Actor, context: "MONTHLY_CLINICAL" | "OPERATIONS", report: unknown) {
  await db.$transaction(async tx => appendAudit(tx, {
    facilityId: actor.facilityId, userId: actor.id, sessionId: actor.sessionId,
    action: "REPORT_ACCESSED", entityType: "Report", entityId: randomUUID(),
    reason: JSON.stringify({ version: 1, context, outcome: "AUTHORISED_DISCLOSURE" }),
    afterHash: auditValueFingerprint(report),
  }));
}
