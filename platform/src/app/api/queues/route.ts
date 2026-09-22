import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import {
  operationalServicePoints,
  queueDurationMinutes,
  queueSortValue,
  servicePointPermission,
  servicePointVisitStatus,
  type OperationalServicePoint,
} from "@/lib/queue-operations";

const servicePoint = z.enum(operationalServicePoints);
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CALL_NEXT"), servicePoint }),
  z.object({ action: z.literal("START"), queueEntryId: z.uuid() }),
  z.object({ action: z.literal("ESCALATE"), queueEntryId: z.uuid(), reason: z.string().trim().min(10).max(500) }),
  z.object({ action: z.literal("TRANSFER"), queueEntryId: z.uuid(), targetServicePoint: servicePoint, reason: z.string().trim().min(5).max(300) }),
  z.object({ action: z.literal("SET_PAUSED"), servicePoint, paused: z.boolean(), reason: z.string().trim().min(5).max(300).optional() }),
  z.object({ action: z.literal("SET_TARGET"), servicePoint, targetMinutes: z.coerce.number().int().min(5).max(480) }),
]);

function assertPointAccess(permissions: string[], point: OperationalServicePoint) {
  if (!permissions.includes(servicePointPermission[point]))
    throw Object.assign(new Error(`Permission denied for ${point.toLowerCase().replaceAll("_", " ")}`), { status: 403 });
}

export async function GET() {
  try {
    const user = await requirePermission("visit.read");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [active, history, controls] = await Promise.all([
      db.queueEntry.findMany({
        where: { visit: { facilityId: user.facilityId }, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
        include: { visit: { select: { id: true, visitNumber: true, clinic: true, status: true, patient: { select: { id: true, patientNumber: true, fullName: true } } } } },
      }),
      db.queueEntry.findMany({
        where: { visit: { facilityId: user.facilityId }, status: { in: ["TRANSFERRED", "COMPLETED", "CANCELLED"] }, completedAt: { gte: since } },
        include: { visit: { select: { visitNumber: true, patient: { select: { patientNumber: true, fullName: true } } } } },
        orderBy: { completedAt: "desc" },
        take: 60,
      }),
      db.servicePointControl.findMany({ where: { facilityId: user.facilityId } }),
    ]);
    const ordered = active.sort((left, right) => queueSortValue(left.priority, left.enteredAt) - queueSortValue(right.priority, right.enteredAt));
    return NextResponse.json({
      entries: ordered,
      controls: operationalServicePoints.map((point) => controls.find((item) => item.servicePoint === point) || { servicePoint: point, paused: false, pauseReason: null, pausedAt: null, targetMinutes: 30 }),
      history: history.map((entry) => ({ ...entry, durationMinutes: queueDurationMinutes(entry.enteredAt, entry.completedAt || new Date()) })),
    });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("visit.read");
    const input = inputSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      if (input.action === "SET_PAUSED") {
        assertPointAccess(user.permissions, input.servicePoint);
        if (input.paused && !input.reason) throw Object.assign(new Error("A pause reason is required"), { status: 422 });
        const control = await tx.servicePointControl.upsert({
          where: { facilityId_servicePoint: { facilityId: user.facilityId, servicePoint: input.servicePoint } },
          update: { paused: input.paused, pauseReason: input.paused ? input.reason : null, pausedAt: input.paused ? new Date() : null, updatedById: user.id },
          create: { facilityId: user.facilityId, servicePoint: input.servicePoint, paused: input.paused, pauseReason: input.paused ? input.reason : null, pausedAt: input.paused ? new Date() : null, updatedById: user.id },
        });
        await appendAudit(tx, { userId: user.id, action: input.paused ? "SERVICE_POINT_PAUSED" : "SERVICE_POINT_RESUMED", entityType: "ServicePointControl", entityId: control.id, reason: input.reason, afterHash: `${input.servicePoint}:${input.paused}` });
        return { control };
      }

      if (input.action === "SET_TARGET") {
        if (!user.permissions.includes("admin.dashboard")) throw Object.assign(new Error("Administration permission is required to change service targets"), { status: 403 });
        const control = await tx.servicePointControl.upsert({
          where: { facilityId_servicePoint: { facilityId: user.facilityId, servicePoint: input.servicePoint } },
          update: { targetMinutes: input.targetMinutes, updatedById: user.id },
          create: { facilityId: user.facilityId, servicePoint: input.servicePoint, targetMinutes: input.targetMinutes, updatedById: user.id },
        });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "SERVICE_POINT_TARGET_UPDATED", entityType: "ServicePointControl", entityId: control.id, afterHash: `${input.servicePoint}:${input.targetMinutes}` });
        return { control };
      }

      if (input.action === "CALL_NEXT") {
        assertPointAccess(user.permissions, input.servicePoint);
        const paused = await tx.servicePointControl.findUnique({ where: { facilityId_servicePoint: { facilityId: user.facilityId, servicePoint: input.servicePoint } } });
        if (paused?.paused) throw Object.assign(new Error(`${input.servicePoint.replaceAll("_", " ")} is paused: ${paused.pauseReason}`), { status: 409 });
        const busy = await tx.queueEntry.findFirst({ where: { visit: { facilityId: user.facilityId }, servicePoint: input.servicePoint, status: { in: ["CALLED", "IN_PROGRESS"] } } });
        if (busy) throw Object.assign(new Error("Finish or transfer the current patient before calling another"), { status: 409 });
        const waiting = await tx.queueEntry.findMany({ where: { visit: { facilityId: user.facilityId }, servicePoint: input.servicePoint, status: "WAITING" }, include: { visit: { select: { patient: { select: { fullName: true } } } } } });
        const next = waiting.sort((left, right) => queueSortValue(left.priority, left.enteredAt) - queueSortValue(right.priority, right.enteredAt))[0];
        if (!next) throw Object.assign(new Error("No patient is waiting at this service point"), { status: 409 });
        const entry = await tx.queueEntry.update({ where: { id: next.id }, data: { status: "CALLED", calledAt: new Date() } });
        await appendAudit(tx, { userId: user.id, action: "QUEUE_PATIENT_CALLED", entityType: "QueueEntry", entityId: entry.id, afterHash: input.servicePoint });
        return { entry, patientName: next.visit.patient.fullName };
      }

      const entry = await tx.queueEntry.findFirst({ where: { id: input.queueEntryId, visit: { facilityId: user.facilityId } }, include: { visit: true } });
      if (!entry) throw Object.assign(new Error("Queue entry not found"), { status: 404 });
      if (entry.visit.clinicallyClosedAt || ["DISCHARGED", "COMPLETED", "CANCELLED"].includes(entry.visit.status)) throw Object.assign(new Error("Closed visits cannot be restarted or transferred"), { status: 409 });
      assertPointAccess(user.permissions, entry.servicePoint as OperationalServicePoint);
      if (!operationalServicePoints.includes(entry.servicePoint as OperationalServicePoint)) throw Object.assign(new Error("This queue is not managed from the operations panel"), { status: 422 });

      if (input.action === "ESCALATE") {
        if (!["WAITING", "CALLED", "IN_PROGRESS"].includes(entry.status)) throw Object.assign(new Error("Only active queue entries can be escalated"), { status: 409 });
        await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "QUEUE_REVIEW_ESCALATED", entityType: "Visit", entityId: entry.visitId, reason: input.reason, afterHash: `${entry.servicePoint}:${entry.priority}` });
        return { recorded: true, servicePoint: entry.servicePoint, message: "Escalation recorded; contact the service lead. Clinical priority was not changed." };
      }

      if (input.action === "START") {
        if (!["WAITING", "CALLED"].includes(entry.status)) throw Object.assign(new Error("Only waiting or called patients can be started"), { status: 409 });
        const updated = await tx.queueEntry.update({ where: { id: entry.id }, data: { status: "IN_PROGRESS", calledAt: entry.calledAt || new Date(), startedAt: new Date() } });
        await appendAudit(tx, { userId: user.id, action: "QUEUE_SERVICE_STARTED", entityType: "QueueEntry", entityId: entry.id, afterHash: entry.servicePoint });
        return { entry: updated };
      }

      assertPointAccess(user.permissions, input.targetServicePoint);
      if (entry.servicePoint === input.targetServicePoint) throw Object.assign(new Error("Choose a different destination service point"), { status: 422 });
      if (!["WAITING", "CALLED", "IN_PROGRESS"].includes(entry.status)) throw Object.assign(new Error("Only active queue entries can be transferred"), { status: 409 });
      const now = new Date();
      await tx.queueEntry.update({ where: { id: entry.id }, data: { status: "TRANSFERRED", completedAt: now } });
      const transferred = await tx.queueEntry.create({ data: { visitId: entry.visitId, servicePoint: input.targetServicePoint, priority: entry.priority } });
      await tx.visit.update({ where: { id: entry.visitId }, data: { status: servicePointVisitStatus[input.targetServicePoint] as never } });
      await appendAudit(tx, { userId: user.id, action: "QUEUE_PATIENT_TRANSFERRED", entityType: "Visit", entityId: entry.visitId, reason: input.reason, beforeHash: entry.servicePoint, afterHash: input.targetServicePoint });
      return { entry: transferred };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
