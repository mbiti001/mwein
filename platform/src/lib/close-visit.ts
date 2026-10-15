import type { Prisma } from "@prisma/client";
import { appendAudit } from "./audit";
import { clinicalClosureBlockers } from "./visit-disposition";
import { ensureServiceTask } from "./visit-handoff";
import { dischargeRevision, dischargeRequestFingerprint } from "./discharge-review";

export async function closeClinicalVisit(tx: Prisma.TransactionClient, actor: { id: string; facilityId: string; sessionId: string }, id: string, input: { outcome: string; details: string; cancelPendingOrders: boolean; requestKey?: string; expectedRevision?: string }) {
  const visit = await tx.visit.findFirst({ where: { id, facilityId: actor.facilityId }, include: { encounters: true, orders: true, dispositionRecord: { include: { recordedBy: { select: { displayName: true } } } } } });
  if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
  if (input.requestKey) {
    const receipt = await tx.auditEvent.findFirst({ where: { facilityId: actor.facilityId, userId: actor.id, entityType: "Visit", entityId: id, action: "VISIT_CLINICALLY_CLOSED", reason: { contains: input.requestKey } } });
    if (receipt) {
      const saved = JSON.parse(receipt.reason || "{}");
      if (saved.requestKey !== input.requestKey || saved.requestFingerprint !== dischargeRequestFingerprint(input) || !visit.clinicallyClosedAt)
        throw Object.assign(new Error("Closure retry differs from the recorded request; review the saved discharge"), { status: 409 });
      await appendAudit(tx, { facilityId: actor.facilityId, userId: actor.id, sessionId: actor.sessionId, action: "CLINICAL_CLOSURE_REPLAY_CONFIRMED", entityType: "Visit", entityId: id });
      return { visit, disposition: visit.dispositionRecord, financialReviewRequired: saved.financialReviewRequired === true, replayed: true };
    }
  }
  if (input.expectedRevision && input.expectedRevision !== dischargeRevision(visit))
    throw Object.assign(new Error("The visit changed after discharge review. Reload the review and check the outstanding work before confirming."), { status: 409 });
  const blockers = clinicalClosureBlockers(visit, input.cancelPendingOrders);
  if (visit.clinicallyClosedAt) blockers.push("Clinical closure is already recorded");
  if (blockers.length) throw Object.assign(new Error(blockers.join(". ")), { status: 409 });
  if (input.outcome === "REFERRED" && !await tx.referral.findFirst({ where: { visitId: id, status: { in: ["SENT", "ACCEPTED", "ATTENDED", "RETURNED", "CLOSED"] } } }))
    throw Object.assign(new Error("Record and send the referral before closure"), { status: 409 });
  const now = new Date();
  const cancelled = visit.orders.filter(order => ["DRAFT", "REQUESTED"].includes(order.status));
  if (cancelled.length) {
    await tx.clinicalOrder.updateMany({ where: { id: { in: cancelled.map(order => order.id) } }, data: { status: "CANCELLED", completedAt: now } });
  }
  await tx.queueEntry.updateMany({ where: { visitId: id, servicePoint: { not: "BILLING" }, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt: now } });
  // Every discharged visit needs administrative review, even if no invoice exists.
  await ensureServiceTask(tx, visit, "BILLING");
  // Invoice items, claims and payments remain intact for independent financial review.
  const disposition = await tx.visitDisposition.upsert({ where: { visitId: id },
    include: { recordedBy: { select: { displayName: true } } },
    create: { facilityId: actor.facilityId, visitId: id, outcome: input.outcome, details: input.details, recordedById: actor.id },
    update: { outcome: input.outcome, details: input.details, recordedById: actor.id, recordedAt: now },
  });
  const updated = await tx.visit.update({ where: { id }, data: { status: "DISCHARGED", clinicallyClosedAt: now } });
  await appendAudit(tx, { facilityId: actor.facilityId, userId: actor.id, sessionId: actor.sessionId, action: "VISIT_CLINICALLY_CLOSED", entityType: "Visit", entityId: id,
    beforeHash: JSON.stringify({ status: visit.status, disposition: visit.dispositionRecord }), afterHash: `${input.outcome}:${now.toISOString()}`,
    reason: JSON.stringify({ details: input.details, cancelledOrderIds: cancelled.map(order => order.id), financialReviewRequired: cancelled.length > 0, ...(input.requestKey ? { requestKey: input.requestKey, requestFingerprint: dischargeRequestFingerprint(input) } : {}) }) });
  return { visit: updated, disposition, financialReviewRequired: cancelled.length > 0 };
}
