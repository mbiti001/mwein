import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { diagnosticOrderSelect } from "@/lib/diagnostic-review";
import { verifiedResultWhere } from "@/lib/verified-results";

export async function GET(request: Request) {
  try {
    const user = await requirePermission("clinical.results.read");
    const params = new URL(request.url).searchParams;
    const state = z.enum(["ALL", "RELEASED", "PENDING", "ACKNOWLEDGED"]).parse(params.get("state") || "ALL");
    const query = z.string().trim().max(100).parse(params.get("q") || "");
    const limit = z.coerce.number().int().min(1).max(100).parse(params.get("limit") ?? 100);
    // The immutable ordering pair is a position, not authority to read its order.
    // Keep it usable even when the boundary order has since been acknowledged.
    const cursorText = z.string().max(100).parse(params.get("cursor") || "");
    const cursor = cursorText ? z.tuple([z.iso.datetime(), z.uuid()]).parse(cursorText.split("_")) : null;
    const conditions: Prisma.ClinicalOrderWhereInput[] = [];
    if (cursor) conditions.push({ OR: [
      { requestedAt: { gt: new Date(cursor[0]) } },
      { requestedAt: new Date(cursor[0]), id: { gt: cursor[1] } },
    ] });
    if (query) conditions.push({ OR: [
      { displayName: { contains: query, mode: "insensitive" } },
      { visit: { visitNumber: { contains: query, mode: "insensitive" } } },
      { visit: { patient: { fullName: { contains: query, mode: "insensitive" } } } },
      { visit: { patient: { patientNumber: { contains: query, mode: "insensitive" } } } },
    ] });
    const released = { OR: [
      { laboratory: { is: { result: { is: verifiedResultWhere } } } },
      { imaging: { is: { result: { is: verifiedResultWhere } } } },
    ] };
    const rows = await db.clinicalOrder.findMany({
      where: { visit: { facilityId: user.facilityId }, type: { in: ["LABORATORY", "IMAGING"] }, status: { not: "CANCELLED" },
        diagnosticReviews: state === "ACKNOWLEDGED" ? { some: { action: "ACKNOWLEDGE" } } : { none: { action: "ACKNOWLEDGE" } },
        ...(state === "RELEASED" ? released : state === "PENDING" ? { NOT: released } : {}),
        AND: conditions,
      },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }], take: limit + 1, select: diagnosticOrderSelect,
    });
    const orders = rows.slice(0, limit);
    await recordClinicalAccess(user, "DIAGNOSTIC_REVIEW", orders.flatMap(order => [
      { type: "Visit" as const, id: order.visit.id }, { type: "ClinicalOrder" as const, id: order.id },
      ...order.diagnosticReviews.map(event => ({ type: "DiagnosticReview" as const, id: event.id })),
    ]));
    const last = orders.at(-1);
    return privateJson({ orders, limit, truncated: rows.length > limit,
      nextCursor: rows.length > limit && last ? `${last.requestedAt.toISOString()}_${last.id}` : null });
  } catch (error) { return apiError(error); }
}
