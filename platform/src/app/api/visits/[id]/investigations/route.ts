import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { verifiedResultWhere } from "@/lib/verified-results";

const limit = 200;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("clinical.results.read");
    const id = z.uuid().parse((await params).id);
    const visit = await db.visit.findFirst({
      where: { id, facilityId: user.facilityId },
      select: {
        id: true, visitNumber: true, status: true, clinicallyClosedAt: true,
        patient: { select: { patientNumber: true, fullName: true } },
        orders: {
          where: { type: { in: ["LABORATORY", "IMAGING"] } },
          orderBy: [{ requestedAt: "desc" }, { id: "asc" }], take: limit + 1,
          select: {
            id: true, type: true, displayName: true, status: true, priority: true,
            clinicalIndication: true, requestedAt: true,
            laboratory: { select: {
              accessionNumber: true, specimenType: true, specimenStatus: true,
              collectedAt: true, receivedAt: true, rejectionReason: true,
              result: { where: verifiedResultWhere, select: {
                id: true, status: true, reportText: true, verifiedAt: true,
                verifiedBy: { select: { displayName: true } },
                criticalResult: true, criticalNotifiedTo: true, criticalNotifiedAt: true,
                criticalNotificationMethod: true, criticalReadBack: true,
                criticalConfirmation: true, criticalEscalation: true,
                items: { select: { id: true, analyte: true, value: true, unit: true, referenceRange: true, flag: true, critical: true } },
              } },
            } },
            imaging: { select: { modality: true, result: { where: verifiedResultWhere, select: {
              id: true, status: true, technique: true, findings: true, conclusion: true, recommendations: true,
              performedAt: true, verifiedAt: true, verifiedBy: { select: { displayName: true } },
            } } } },
          },
        },
      },
    });
    if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
    const orders = visit.orders.slice(0, limit);
    await recordClinicalAccess(user, "VISIT_INVESTIGATIONS", [
      { type: "Visit", id: visit.id },
      ...orders.flatMap(order => [
        ...(order.laboratory?.result ? [{ type: "LaboratoryResult" as const, id: order.laboratory.result.id }] : []),
        ...(order.imaging?.result ? [{ type: "ImagingResult" as const, id: order.imaging.result.id }] : []),
      ]),
    ]);
    return privateJson({ visit: { ...visit, orders }, truncated: visit.orders.length > limit, limit });
  } catch (error) { return apiError(error); }
}
