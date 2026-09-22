import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { canTransitionRightsRequest, patientRightsStatuses, patientRightsTypes, requiresRightsOutcome, rightsRequestDueAt } from "@/lib/certification-workflows";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

const createSchema = z.object({ action: z.literal("CREATE"), patientId: z.uuid(), type: z.enum(patientRightsTypes), channel: z.enum(["IN_PERSON", "EMAIL", "LETTER", "PHONE", "PORTAL"]), details: z.string().trim().min(10).max(3000), assignedToId: z.uuid().optional() });
const updateSchema = z.object({ action: z.literal("UPDATE"), id: z.uuid(), status: z.enum(patientRightsStatuses), assignedToId: z.uuid().optional(), outcome: z.string().trim().min(10).max(3000).optional(), evidenceReference: z.string().trim().min(5).max(800).optional() });

export async function GET() {
  try {
    const user = await requirePermission("admin.operations");
    const requests = await db.patientRightsRequest.findMany({ where: { facilityId: user.facilityId }, include: { patient: { select: { patientNumber: true, fullName: true } }, assignedTo: { select: { displayName: true } }, createdBy: { select: { displayName: true } }, resolvedBy: { select: { displayName: true } } }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 200 });
    return NextResponse.json({ requests }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("admin.operations");
    const input = z.discriminatedUnion("action", [createSchema, updateSchema]).parse(await request.json());
    if (input.action === "CREATE") {
      const patient = await db.patient.findFirst({ where: { id: input.patientId, facilityId: user.facilityId, active: true }, select: { id: true } });
      if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
      const created = await db.$transaction(async (tx) => {
        const facility = await tx.facility.findUniqueOrThrow({ where: { id: user.facilityId }, select: { code: true } });
        const year = new Date().getFullYear();
        const sequence = await tx.referenceSequence.upsert({ where: { facilityId_kind_year: { facilityId: user.facilityId, kind: "PATIENT_RIGHTS", year } }, update: { nextValue: { increment: 1 } }, create: { facilityId: user.facilityId, kind: "PATIENT_RIGHTS", year, nextValue: 2 } });
        const item = await tx.patientRightsRequest.create({ data: { facilityId: user.facilityId, patientId: input.patientId, requestNumber: `${facility.code}-DSR-${year}-${(sequence.nextValue - 1n).toString().padStart(6, "0")}`, type: input.type, channel: input.channel, details: input.details, dueAt: rightsRequestDueAt(), assignedToId: input.assignedToId, createdById: user.id } });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "PATIENT_RIGHTS_REQUEST_RECEIVED", entityType: "PatientRightsRequest", entityId: item.id, afterHash: `${item.requestNumber}:${item.type}:${item.dueAt.toISOString()}` });
        return item;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json({ request: created }, { status: 201 });
    }
    const previous = await db.patientRightsRequest.findFirst({ where: { id: input.id, facilityId: user.facilityId } });
    if (!previous) throw Object.assign(new Error("Request not found"), { status: 404 });
    if (!canTransitionRightsRequest(previous.status, input.status)) throw Object.assign(new Error(`Cannot move ${previous.status} to ${input.status}`), { status: 409 });
    if (requiresRightsOutcome(input.status) && (!input.outcome || !input.evidenceReference)) throw Object.assign(new Error("Completed or denied requests require an outcome and retained evidence reference"), { status: 422 });
    const terminal = ["COMPLETED", "DENIED", "CANCELLED"].includes(input.status);
    const updated = await db.$transaction(async (tx) => {
      const item = await tx.patientRightsRequest.update({ where: { id: input.id }, data: { status: input.status, assignedToId: input.assignedToId, outcome: input.outcome, evidenceReference: input.evidenceReference, resolvedById: terminal ? user.id : null, resolvedAt: terminal ? new Date() : null } });
      await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "PATIENT_RIGHTS_REQUEST_UPDATED", entityType: "PatientRightsRequest", entityId: item.id, beforeHash: previous.status, afterHash: item.status, reason: input.outcome });
      return item;
    });
    return NextResponse.json({ request: updated });
  } catch (error) { return apiError(error); }
}
