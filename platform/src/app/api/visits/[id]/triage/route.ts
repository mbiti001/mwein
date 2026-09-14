import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { assessTriageVitals, assertVisitTransition, triageSchema } from "@/lib/domain";

const observationDefinitions = [
  ["TEMP", "temperatureC", "°C"], ["PULSE", "pulseBpm", "bpm"], ["RESP_RATE", "respiratoryRate", "/min"],
  ["BP_SYS", "systolicBp", "mmHg"], ["BP_DIA", "diastolicBp", "mmHg"], ["SPO2", "oxygenSaturation", "%"],
  ["WEIGHT", "weightKg", "kg"], ["HEIGHT", "heightCm", "cm"], ["PAIN", "painScore", "/10"]
] as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("triage.write");
    const { id } = await context.params;
    const input = triageSchema.parse(await request.json());
    const alerts = assessTriageVitals(input);
    const criticalMessages = new Set(alerts.filter(alert => alert.severity === "CRITICAL").map(alert => alert.message));
    const result = await db.$transaction(async tx => {
      const visit = await tx.visit.findFirst({ where: { id, facilityId: user.facilityId }, include: { triage: true, queues: { where: { servicePoint: "TRIAGE", status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } } } } });
      if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
      if (visit.triage) throw Object.assign(new Error("Triage has already been completed for this visit"), { status: 409 });
      assertVisitTransition(visit.status, "AWAITING_CLINICIAN");
      await tx.triageRecord.create({ data: {
        visitId: visit.id, chiefComplaint: input.chiefComplaint, triageCategory: input.triageCategory, notes: input.notes,
        pregnancyStatus: input.pregnancyStatus, lastMenstrualPeriod: input.lastMenstrualPeriod ? new Date(input.lastMenstrualPeriod) : null,
        completedAt: new Date(), observations: { create: [
          ...observationDefinitions.filter(([, key]) => input[key] !== undefined).map(([code, key, unit]) => ({ code, unit, valueDecimal: new Prisma.Decimal(input[key] as number), abnormal: alerts.length > 0, critical: code === "SPO2" ? input.oxygenSaturation < 90 : code === "BP_SYS" ? input.systolicBp < 90 || input.systolicBp >= 180 : code === "BP_DIA" ? input.diastolicBp >= 120 : false })),
          { code: "CONSCIOUSNESS", valueText: input.consciousness, abnormal: input.consciousness !== "ALERT", critical: input.consciousness !== "ALERT" }
        ] }
      } });
      await tx.queueEntry.updateMany({ where: { id: { in: visit.queues.map(queue => queue.id) } }, data: { status: "COMPLETED", completedAt: new Date() } });
      await tx.queueEntry.create({ data: { visitId: visit.id, servicePoint: "CONSULTATION", priority: input.triageCategory, status: "WAITING" } });
      const updated = await tx.visit.update({ where: { id: visit.id }, data: { status: "AWAITING_CLINICIAN", priority: input.triageCategory }, include: { patient: true, queues: true, triage: { include: { observations: true } } } });
      await appendAudit(tx, { userId: user.id, action: "TRIAGE_COMPLETED", entityType: "Visit", entityId: visit.id, beforeHash: `${visit.status}:${visit.priority}`, afterHash: `${updated.status}:${updated.priority}`, reason: criticalMessages.size ? [...criticalMessages].join("; ") : undefined });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ visit: result, alerts });
  } catch (error) { return apiError(error); }
}
