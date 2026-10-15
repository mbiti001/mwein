import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { diagnosticReviewInput, diagnosticOrderSelect, diagnosticEventSelect } from "@/lib/diagnostic-review";

type Context = { params: Promise<{ id: string }> };
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requirePermission("clinical.results.read");
    const id = z.uuid().parse((await params).id);
    const order = await db.clinicalOrder.findFirst({ where: { id, visit: { facilityId: user.facilityId }, type: { in: ["LABORATORY", "IMAGING"] } },
      select: { ...diagnosticOrderSelect, diagnosticReviews: { orderBy: { sequence: "desc" }, take: 51, select: diagnosticEventSelect } },
    });
    if (!order) throw fail("Investigation not found", 404);
    await recordClinicalAccess(user, "DIAGNOSTIC_REVIEW", [
      { type: "Visit", id: order.visit.id }, { type: "ClinicalOrder", id: order.id },
      ...order.diagnosticReviews.slice(0, 50).map(event => ({ type: "DiagnosticReview" as const, id: event.id })),
    ]);
    return privateJson({ order: { ...order, diagnosticReviews: order.diagnosticReviews.slice(0, 50) }, historyTruncated: order.diagnosticReviews.length > 50,
      canReview: user.permissions.includes("encounter.write"), actorId: user.id });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requirePermission("encounter.write");
    if (!user.permissions.includes("clinical.results.read")) throw fail("Permission denied", 403);
    const id = z.uuid().parse((await params).id);
    const input = diagnosticReviewInput.parse(await request.json());
    const requestHash = auditValueFingerprint({ orderId: id, actorId: user.id, input });
    const result = await db.$transaction(async tx => {
      // Serialize all ownership/review transitions on this facility-scoped order.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT o."id" FROM "ClinicalOrder" o JOIN "Visit" v ON v."id" = o."visitId" WHERE o."id" = ${id}::uuid AND v."facilityId" = ${user.facilityId}::uuid FOR UPDATE OF o`;
      if (!locked.length) throw fail("Investigation not found", 404);
      const order = await tx.clinicalOrder.findFirst({ where: { id, visit: { facilityId: user.facilityId }, type: { in: ["LABORATORY", "IMAGING"] } }, select: diagnosticOrderSelect });
      if (!order) throw fail("Investigation not found", 404);
      const priorRequest = await tx.diagnosticReview.findUnique({ where: { requestKey: input.requestKey } });
      if (priorRequest) {
        if (priorRequest.orderId !== id || priorRequest.actorId !== user.id || priorRequest.requestHash !== requestHash) throw fail("This request key belongs to a different action. Reload the saved review.");
        await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "DIAGNOSTIC_REVIEW_REPLAYED", entityType: "DiagnosticReview", entityId: priorRequest.id });
        return { eventId: priorRequest.id, replayed: true };
      }
      const latest = order.diagnosticReviews[0];
      if (order.status === "CANCELLED") throw fail("This investigation was cancelled. No review action can be added.");
      if ((latest?.id || null) !== input.expectedEventId) throw fail("Review ownership changed. Reload the saved review before continuing.");
      if (latest?.action === "ACKNOWLEDGE") throw fail("The report has already been acknowledged. The saved review is retained.");
      if (input.action === "CLAIM" && latest?.actor.id === user.id) throw fail("You already own this review.");
      if (input.action === "ACKNOWLEDGE") {
        if (latest?.action !== "CLAIM" || latest.actor.id !== user.id) throw fail("Accept responsibility for this review before acknowledging it.");
        const report = order.laboratory?.result || order.imaging?.result;
        if (!report?.verifiedAt || report.id !== input.resultId || report.verifiedAt.toISOString() !== input.verifiedAt) throw fail("The selected verified report is unavailable or changed. Reload and read the released report.");
      }
      const event = await tx.diagnosticReview.create({ data: {
        orderId: id, actorId: user.id, sequence: (latest?.sequence || 0) + 1, action: input.action, note: input.note,
        requestKey: input.requestKey, requestHash,
        ...(input.action === "ACKNOWLEDGE" ? { resultId: input.resultId, verifiedAt: new Date(input.verifiedAt) } : {}),
      } });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId,
        action: input.action === "CLAIM" ? "DIAGNOSTIC_REVIEW_CLAIMED" : "DIAGNOSTIC_REPORT_ACKNOWLEDGED",
        entityType: "DiagnosticReview", entityId: event.id, beforeHash: auditValueFingerprint(latest?.id || null), afterHash: auditValueFingerprint(event),
      });
      return { eventId: event.id, replayed: false };
    }, { timeout: 15_000 });
    return privateJson(result, { status: result.replayed ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
