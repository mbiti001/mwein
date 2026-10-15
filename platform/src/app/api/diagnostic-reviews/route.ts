import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { diagnosticOrderSelect } from "@/lib/diagnostic-review";
import { verifiedResultWhere } from "@/lib/verified-results";

export async function GET(request: Request) {
  try {
    const user = await requirePermission("clinical.results.read");
    const state = z.enum(["ALL", "RELEASED", "PENDING", "ACKNOWLEDGED"]).parse(new URL(request.url).searchParams.get("state") || "ALL");
    const released = { OR: [
      { laboratory: { is: { result: { is: verifiedResultWhere } } } },
      { imaging: { is: { result: { is: verifiedResultWhere } } } },
    ] };
    const rows = await db.clinicalOrder.findMany({
      where: { visit: { facilityId: user.facilityId }, type: { in: ["LABORATORY", "IMAGING"] }, status: { not: "CANCELLED" },
        diagnosticReviews: state === "ACKNOWLEDGED" ? { some: { action: "ACKNOWLEDGE" } } : { none: { action: "ACKNOWLEDGE" } },
        ...(state === "RELEASED" ? released : state === "PENDING" ? { NOT: released } : {}),
      },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }], take: 101, select: diagnosticOrderSelect,
    });
    const orders = rows.slice(0, 100);
    await recordClinicalAccess(user, "DIAGNOSTIC_REVIEW", orders.flatMap(order => [
      { type: "Visit" as const, id: order.visit.id }, { type: "ClinicalOrder" as const, id: order.id },
      ...order.diagnosticReviews.map(event => ({ type: "DiagnosticReview" as const, id: event.id })),
    ]));
    return privateJson({ orders, limit: 100, truncated: rows.length > 100 });
  } catch (error) { return apiError(error); }
}
