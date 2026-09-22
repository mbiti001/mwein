import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { apiError, privateJson } from "@/lib/http";
import { measuredVitalsSchema } from "@/lib/measured-vitals";
const selection = { id: true, measuredAt: true, recordedAt: true, values: true, note: true, recordedBy: { select: { displayName: true } } };
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("vitals.write");
    const id = z.uuid().parse((await context.params).id);
    if (!await db.visit.findFirst({ where: { id, facilityId: user.facilityId }, select: { id: true } })) throw Object.assign(new Error("Visit not found"), { status: 404 });
    const records = await db.measuredVitals.findMany({ where: { visitId: id }, select: selection, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 51 });
    const result = { measurements: records.slice(0, 50), truncated: records.length > 50 };
    await recordDisclosure(user, "MEASURED_VITALS", records.map(record => record.id), result);
    return privateJson(result);
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("vitals.write");
    const id = z.uuid().parse((await context.params).id);
    const input = measuredVitalsSchema.parse(await request.json());
    const measurement = await db.$transaction(async tx => {
      // Lock the visit against concurrent clinical closure before recording a measurement.
      const visits = await tx.$queryRaw<Array<{ id: string; status: string; clinicallyClosedAt: Date | null }>>`SELECT "id", "status", "clinicallyClosedAt" FROM "Visit" WHERE "id" = ${id}::uuid AND "facilityId" = ${user.facilityId}::uuid FOR UPDATE`;
      const visit = visits[0];
      if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
      if (["COMPLETED", "CANCELLED"].includes(visit.status) || visit.clinicallyClosedAt) throw Object.assign(new Error("This visit is closed; start an appropriate new visit for further measurements"), { status: 409 });
      const record = await tx.measuredVitals.create({ data: { visitId: id, recordedById: user.id, measuredAt: new Date(input.measuredAt), values: input.values, note: input.note }, select: selection });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "VITALS_MEASURED", entityType: "MeasuredVitals", entityId: record.id, afterHash: auditValueFingerprint({ visitId: id, input }) });
      return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return privateJson({ measurement, triageCompleted: false }, { status: 201 });
  } catch (error) { return apiError(error); }
}
