import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { measuredVitalFields, type MeasuredValues } from "@/lib/measured-vitals";
import { workflowTransaction } from "@/lib/workflow-transaction";
import { assessTriageVitals, assertVisitTransition, triageSchema } from "@/lib/domain";
import { dateInTimeZone, pregnancyDatingFromLnmp } from "@/lib/pregnancy-dating";

const observationDefinitions = [
  ["TEMP", "temperatureC", "°C"], ["PULSE", "pulseBpm", "bpm"], ["RESP_RATE", "respiratoryRate", "/min"],
  ["BP_SYS", "systolicBp", "mmHg"], ["BP_DIA", "diastolicBp", "mmHg"], ["SPO2", "oxygenSaturation", "%"],
  ["WEIGHT", "weightKg", "kg"], ["HEIGHT", "heightCm", "cm"], ["PAIN", "painScore", "/10"]
] as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("triage.write");
    const id = z.uuid().parse((await context.params).id);
    const input = triageSchema.parse(await request.json());
    const requestHash = auditValueFingerprint({ visitId: id, actorId: user.id, input });
    const dating = input.lastMenstrualPeriod
      ? pregnancyDatingFromLnmp(input.lastMenstrualPeriod, dateInTimeZone(new Date(), user.facility.timezone))
      : null;
    if (input.lastMenstrualPeriod && !dating)
      throw Object.assign(new Error("LNMP must be a valid date that is not in the future"), { status: 422 });
    const alerts = assessTriageVitals(input);
    const criticalMessages = new Set(alerts.filter(alert => alert.severity === "CRITICAL").map(alert => alert.message));
    const result = await workflowTransaction(async tx => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Visit" WHERE "id" = ${id}::uuid AND "facilityId" = ${user.facilityId}::uuid FOR UPDATE`;
      if (!locked.length) throw Object.assign(new Error("Visit not found"), { status: 404 });
      const visit = await tx.visit.findFirst({ where: { id, facilityId: user.facilityId }, include: { triage: true, queues: { where: { servicePoint: "TRIAGE", status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } } } } });
      if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
      if (visit.triage && input.requestKey) {
        const receipt = await tx.auditEvent.findFirst({ where: { facilityId: user.facilityId, userId: user.id, action: "TRIAGE_COMPLETED", entityId: id, reason: { contains: input.requestKey } }, orderBy: { occurredAt: "desc" } });
        let retained: { requestKey?: string; requestHash?: string } = {};
        try { retained = JSON.parse(receipt?.reason || "{}"); } catch { /* Legacy evidence is not an exact retry receipt. */ }
        if (retained.requestKey === input.requestKey && retained.requestHash === requestHash) {
          await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "TRIAGE_REPLAY_CONFIRMED", entityType: "Visit", entityId: id, afterHash: requestHash });
          return { visit: { id: visit.id, status: visit.status }, replayed: true };
        }
      }
      if (visit.triage) throw Object.assign(new Error("Triage has already been completed for this visit"), { status: 409 });
      if (visit.clinicallyClosedAt) throw Object.assign(new Error("This visit is clinically closed"), { status: 409 });
      assertVisitTransition(visit.status, "AWAITING_CLINICIAN");
      const values = Object.fromEntries(measuredVitalFields.filter(field => input[field.key] !== undefined).map(field => [field.key, input[field.key]])) as MeasuredValues;
      let measurementId = input.reviewedVitalsId;
      let sourceNote: string | undefined;
      if (measurementId) {
        const source = await tx.measuredVitals.findFirst({ where: { id: measurementId, visitId: visit.id }, select: { id: true, values: true, measuredAt: true, recordedBy: { select: { displayName: true } } } });
        if (!source) throw Object.assign(new Error("Source measurements do not belong to this visit"), { status: 422 });
        const saved = source.values as MeasuredValues;
        if (measuredVitalFields.some(field => saved[field.key] !== undefined && saved[field.key] !== values[field.key])) throw Object.assign(new Error("Saved measurements differ from this assessment. Reuse the recorded set unchanged or record a new set."), { status: 409 });
        const additions = measuredVitalFields.filter(field => saved[field.key] === undefined && values[field.key] !== undefined);
        if (additions.length) {
          sourceNote = `Completed from set ${source.id}, measured ${source.measuredAt.toISOString()}, recorded by ${source.recordedBy.displayName}. Added at the completion time: ${additions.map(field => field.label).join(", ")}. Original set retained.`;
          measurementId = undefined;
        }
      }
      if (!measurementId) {
        const measured = await tx.measuredVitals.create({ data: { visitId: id, recordedById: user.id, measuredAt: input.measuredAt ? new Date(input.measuredAt) : new Date(), values, note: sourceNote }, select: { id: true } });
        measurementId = measured.id;
        await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "VITALS_MEASURED", entityType: "MeasuredVitals", entityId: measured.id, afterHash: auditValueFingerprint({ visitId: id, values }), reason: JSON.stringify({ workflow: "clinical triage", completedFrom: input.reviewedVitalsId, sourceNote }) });
      }
      await tx.triageRecord.create({ data: {
        visitId: visit.id, reviewedVitalsId: measurementId, chiefComplaint: input.chiefComplaint, triageCategory: input.triageCategory, notes: input.notes,
        pregnancyStatus: input.pregnancyStatus, lastMenstrualPeriod: input.lastMenstrualPeriod ? new Date(input.lastMenstrualPeriod) : null,
        estimatedDeliveryDate: dating ? new Date(`${dating.estimatedDeliveryDate}T00:00:00.000Z`) : null,
        gestationalAgeWeeks: dating?.gestationalAgeWeeks,
        gestationalAgeDays: dating?.gestationalAgeDays,
        pregnancyDatingMethod: dating?.method,
        completedAt: new Date(), observations: { create: [
          ...observationDefinitions.filter(([, key]) => input[key] !== undefined).map(([code, key, unit]) => ({ code, unit, valueDecimal: new Prisma.Decimal(input[key] as number), abnormal: alerts.length > 0, critical: code === "SPO2" ? input.oxygenSaturation < 90 : code === "BP_SYS" ? input.systolicBp < 90 || input.systolicBp >= 180 : code === "BP_DIA" ? input.diastolicBp >= 120 : false })),
          { code: "CONSCIOUSNESS", valueText: input.consciousness, abnormal: input.consciousness !== "ALERT", critical: input.consciousness !== "ALERT" }
        ] }
      } });
      await tx.queueEntry.updateMany({ where: { id: { in: visit.queues.map(queue => queue.id) } }, data: { status: "COMPLETED", completedAt: new Date() } });
      await tx.queueEntry.create({ data: { visitId: visit.id, servicePoint: "CONSULTATION", priority: input.triageCategory, status: "WAITING" } });
      const updated = await tx.visit.update({ where: { id: visit.id }, data: { status: "AWAITING_CLINICIAN", priority: input.triageCategory }, include: { patient: true, queues: true, triage: { include: { observations: true } } } });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "TRIAGE_COMPLETED", entityType: "Visit", entityId: visit.id, beforeHash: `${visit.status}:${visit.priority}`, afterHash: `${updated.status}:${updated.priority}`, reason: JSON.stringify({ version: 1, requestKey: input.requestKey, requestHash, measurementId, criticalAlerts: [...criticalMessages] }) });
      return { visit: updated, replayed: false };
    });
    return privateJson({ ...result, alerts });
  } catch (error) { return apiError(error); }
}
