import type { Prisma } from "@prisma/client";
import { appendAudit } from "./audit";
import { clinicalClosureBlockers } from "./visit-disposition";

export async function closeClinicalVisit(tx: Prisma.TransactionClient, actor: { id: string; facilityId: string; sessionId: string }, id: string, input: { outcome: string; details: string; cancelPendingOrders: boolean }) {
  const visit = await tx.visit.findFirst({ where: { id, facilityId: actor.facilityId }, include: { encounters: true, orders: true, dispositionRecord: true } });
  if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
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
  await tx.queueEntry.updateMany({ where: { visitId: id, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt: now } });
  // Invoice items, claims and payments remain intact for independent financial review.
  const disposition = await tx.visitDisposition.upsert({ where: { visitId: id },
    create: { facilityId: actor.facilityId, visitId: id, outcome: input.outcome, details: input.details, recordedById: actor.id },
    update: { outcome: input.outcome, details: input.details, recordedById: actor.id, recordedAt: now },
  });
  const updated = await tx.visit.update({ where: { id }, data: { status: "DISCHARGED", clinicallyClosedAt: now } });
  await appendAudit(tx, { facilityId: actor.facilityId, userId: actor.id, sessionId: actor.sessionId, action: "VISIT_CLINICALLY_CLOSED", entityType: "Visit", entityId: id,
    beforeHash: JSON.stringify({ status: visit.status, disposition: visit.dispositionRecord }), afterHash: `${input.outcome}:${now.toISOString()}`,
    reason: JSON.stringify({ details: input.details, cancelledOrderIds: cancelled.map(order => order.id), financialReviewRequired: cancelled.length > 0 }) });
  return { visit: updated, disposition, financialReviewRequired: cancelled.length > 0 };
}
