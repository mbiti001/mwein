import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { apiError, privateJson } from "@/lib/http";

const querySchema = z.object({
  visitId: z.uuid(),
  recordId: z.uuid(),
  beforeVersion: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(2147483647)).optional(),
}).strict();
const limit = 20;

// Per-record versions are unique and immutable. A descending version cursor
// cannot skip or repeat older rows when another save appends a newer version.
export async function GET(request: Request) {
  try {
    const user = await requirePermission("encounter.write");
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1))
      throw Object.assign(new Error("Repeated history query parameters are not allowed"), { status: 422 });
    const query = querySchema.parse(Object.fromEntries(params));
    const record = await db.servicePointRecord.findFirst({
      where: {
        id: query.recordId,
        encounter: { visitId: query.visitId, visit: { facilityId: user.facilityId }, status: { in: ["DRAFT", "SIGNED", "CORRECTED"] } },
      },
      select: { id: true, encounterId: true },
    });
    if (!record) throw Object.assign(new Error("Assessment not found"), { status: 404 });
    const rows = await db.servicePointRevision.findMany({
      where: {
        recordId: record.id, encounterId: record.encounterId,
        visitId: query.visitId, facilityId: user.facilityId,
        ...(query.beforeVersion === undefined ? {} : { version: { lt: query.beforeVersion } }),
      },
      orderBy: { version: "desc" },
      take: limit + 1,
      select: {
        id: true, version: true, previousVersion: true, kind: true,
        servicePoint: true, templateVersion: true, data: true,
        riskLevel: true, followUpAt: true, sourceCreatedAt: true,
        sourceUpdatedAt: true, capturedAt: true, sessionId: true,
        recordedBy: { select: { id: true, displayName: true } },
      },
    });
    const items = rows.slice(0, limit).map(({ sessionId, ...row }) => ({
      ...row, sessionAttribution: sessionId ? "RECORDED" : "NOT_AVAILABLE",
    }));
    // Audit exactly the disclosed page, excluding the look-ahead row. Never
    // return clinical values if the authenticated disclosure cannot be retained.
    await recordDisclosure(user, "SERVICE_POINTS", [query.visitId, record.id, ...items.map(item => item.id)]);
    const hasMore = rows.length > limit;
    return privateJson({
      visitId: query.visitId, recordId: record.id, encounterId: record.encounterId,
      items, limit, hasMore,
      nextBeforeVersion: hasMore ? items[items.length - 1].version : null,
      // An empty initial read does not assert that uncaptured old values never existed.
      coverage: query.beforeVersion === undefined && items.length === 0 ? "NO_RETAINED_SNAPSHOTS" : "RETAINED_SNAPSHOTS_ONLY",
    });
  } catch (error) {
    return apiError(error);
  }
}
