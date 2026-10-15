import { workflowTransaction } from "@/lib/workflow-transaction";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { visitCompletionBlockers } from "@/lib/visit-completion";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("billing.write");
    const { id } = await context.params;
    const result = await workflowTransaction(async tx => {
      const visit = await tx.visit.findFirst({
        where: { id, facilityId: user.facilityId },
        include: { encounters: true, orders: true, dispositionRecord: true, invoice: { include: { items: true, payments: true, claims: true } } },
      });
      if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
      if (visit.status === "COMPLETED") {
        const receipt = await tx.auditEvent.findFirst({ where: { facilityId: user.facilityId, userId: user.id, entityType: "Visit", entityId: id, action: "VISIT_COMPLETED" } });
        if (!receipt) throw Object.assign(new Error("This visit was already completed. Refresh the worklist."), { status: 409 });
        await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "VISIT_COMPLETION_REPLAY_CONFIRMED", entityType: "Visit", entityId: id });
        return { id: visit.id, visitNumber: visit.visitNumber, status: visit.status, completedAt: visit.completedAt };
      }
      const blockers = visitCompletionBlockers(visit);
      if (blockers.length) throw Object.assign(new Error(blockers.join(". ")), { status: 409 });
      const completedAt = new Date();
      await tx.queueEntry.updateMany({ where: { visitId: id, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "COMPLETED", completedAt } });
      const completed = await tx.visit.update({ where: { id }, data: { status: "COMPLETED", completedAt } });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "VISIT_COMPLETED", entityType: "Visit", entityId: id, beforeHash: visit.status, afterHash: `${visit.dispositionRecord!.outcome}:${completedAt.toISOString()}` });
      return completed;
    });
    return privateJson({ visit: result });
  } catch (error) {
    return apiError(error);
  }
}
