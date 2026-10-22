import type { Prisma, ServicePointRecord } from "@prisma/client";
import { assessmentAuditFingerprint } from "./assessment-audit";

type Context = { facilityId: string; visitId: string };

function historyConflict() {
  return Object.assign(new Error("The saved assessment does not match its retained history. Your entries have not been saved. Contact an administrator before continuing."), {
    status: 409, details: { code: "ASSESSMENT_HISTORY_INCONSISTENT" },
  });
}

/** Called before writes inside the existing Serializable save transaction.
 * Missing/stale history is a cutover integrity problem, never permission to
 * manufacture a migration baseline or discard the uncaptured current values.
 */
export async function retainedAssessmentVersion(tx: Prisma.TransactionClient, context: Context, previous: ServicePointRecord | null) {
  if (!previous) return 0;
  const head = await tx.servicePointRevision.findFirst({
    where: { recordId: previous.id, encounterId: previous.encounterId, facilityId: context.facilityId, visitId: context.visitId },
    orderBy: { version: "desc" },
  });
  if (!head || head.recordId !== previous.id || head.encounterId !== previous.encounterId || head.visitId !== context.visitId || head.facilityId !== context.facilityId)
    throw historyConflict();
  const retained = { ...head, id: head.recordId, updatedById: head.recordedById, updatedAt: head.sourceUpdatedAt };
  if (head.sourceCreatedAt.getTime() !== previous.createdAt.getTime() ||
      assessmentAuditFingerprint(context.facilityId, context.visitId, retained) !== assessmentAuditFingerprint(context.facilityId, context.visitId, previous))
    throw historyConflict();
  return head.version;
}

/** Snapshot the database result, not request input. Do not catch/retry here:
 * append/projection/signer revision/queue/audit must commit or roll back together.
 */
export function captureAssessmentRevision(tx: Prisma.TransactionClient, context: Context & { sessionId: string }, previousVersion: number, record: ServicePointRecord) {
  return tx.servicePointRevision.create({
    data: {
      recordId: record.id, encounterId: record.encounterId,
      facilityId: context.facilityId, visitId: context.visitId,
      version: previousVersion + 1, previousVersion: previousVersion || null,
      kind: "DRAFT_SAVE", servicePoint: record.servicePoint,
      templateVersion: record.templateVersion, data: record.data as Prisma.InputJsonObject,
      riskLevel: record.riskLevel, followUpAt: record.followUpAt,
      recordedById: record.updatedById, sessionId: context.sessionId,
      sourceCreatedAt: record.createdAt, sourceUpdatedAt: record.updatedAt,
      // id and capturedAt use database defaults; Session deletion must not erase evidence.
    },
    select: { id: true, version: true },
  });
}
