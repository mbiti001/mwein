import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { closeVisitSchema, clinicalClosureBlockers } from "@/lib/visit-disposition";
import { closeClinicalVisit } from "@/lib/close-visit";
import { dischargeRevision } from "@/lib/discharge-review";
import { workflowTransaction } from "@/lib/workflow-transaction";
import { recordClinicalAccess } from "@/lib/clinical-access";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePermission("encounter.write");
    const { id } = await context.params;
    const visit = await db.visit.findFirst({ where: { id, facilityId: actor.facilityId }, include: {
      encounters: { select: { id: true, status: true } },
      orders: { select: { id: true, displayName: true, type: true, status: true, orderedBy: { select: { displayName: true } } }, orderBy: { requestedAt: "asc" } },
      dispositionRecord: { include: { recordedBy: { select: { displayName: true } } } },
    } });
    if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
    await recordClinicalAccess(actor, "DISCHARGE_REVIEW", [{ type: "Visit", id }]);
    return privateJson({ revision: dischargeRevision(visit), visitNumber: visit.visitNumber, status: visit.status,
      closedAt: visit.clinicallyClosedAt, disposition: visit.dispositionRecord, orders: visit.orders,
      blockers: clinicalClosureBlockers(visit, true),
    });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePermission("encounter.write");
    const { id } = await context.params;
    const input = closeVisitSchema.parse(await request.json());
    const result = await workflowTransaction(tx => closeClinicalVisit(tx, actor, id, input));
    return privateJson(result);
  } catch (error) { return apiError(error); }
}
