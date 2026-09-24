import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { apiError, privateJson } from "@/lib/http";
import { assertSurveillanceAction, surveillanceChange, surveillanceDescriptor, surveillanceDetails, surveillanceHash, manualNotification } from "@/lib/surveillance";

const createSchema = z.object({ details: surveillanceDetails }).strict();
const selection = { id: true, version: true, status: true, priority: true, details: true, duplicateOfId: true, createdAt: true, updatedAt: true };
const statusQuery = z.enum(["OPEN", "REVIEWED", "CLOSED", "ALL"]);
async function checkPatient(tx: Prisma.TransactionClient, patientId: string | null, facilityId: string) {
  if (patientId && !await tx.patient.findFirst({ where: { id: patientId, facilityId }, select: { id: true } })) throw Object.assign(new Error("Patient not found in this facility"), { status: 404 });
}
export async function GET(request: Request) {
  try {
    const user = await requirePermission("surveillance.read");
    const query = new URL(request.url).searchParams;
    const id = query.get("id");
    if (id) {
      const record = await db.surveillanceRecord.findFirst({ where: { id: z.uuid().parse(id), facilityId: user.facilityId }, select: { ...selection, patient: { select: { patientNumber: true, fullName: true } }, entries: { orderBy: { version: "desc" }, include: { actor: { select: { displayName: true } } } } } });
      if (!record) throw Object.assign(new Error("Record not found"), { status: 404 });
      const result = { ...surveillanceDescriptor, record };
      await recordDisclosure(user, "SURVEILLANCE", [record.id], result);
      return privateJson(result);
    }
    const status = statusQuery.parse(query.get("status") || "OPEN");
    const cursor = query.get("cursor");
    const priority = z.enum(["ALL", "UNASSESSED", "URGENT", "ROUTINE"]).parse(query.get("priority") || "ALL");
    const position = cursor ? z.tuple([z.iso.datetime(), z.uuid()]).parse(cursor.split("|")) : null;
    const records = await db.surveillanceRecord.findMany({ where: { facilityId: user.facilityId, ...(status === "ALL" ? {} : { status }), ...(priority === "ALL" ? {} : { priority }), ...(position ? { OR: [{ createdAt: { lt: new Date(position[0]) } }, { createdAt: new Date(position[0]), id: { lt: position[1] } }] } : {}) }, select: selection, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 });
    const result = { ...surveillanceDescriptor, records: records.slice(0, 50), nextCursor: records.length > 50 ? `${records[49].createdAt.toISOString()}|${records[49].id}` : null };
    await recordDisclosure(user, "SURVEILLANCE", result.records.map(record => record.id), result);
    return privateJson(result);
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requirePermission("surveillance.record");
    const input = createSchema.parse(await request.json());
    const record = await db.$transaction(async tx => {
      await checkPatient(tx, input.details.patientId, user.facilityId);
      const record = await tx.surveillanceRecord.create({ data: { facilityId: user.facilityId, patientId: input.details.patientId, priority: input.details.priority, details: input.details }, select: selection });
      const snapshot = { details: input.details, status: record.status, version: record.version, duplicateOfId: null };
      const hash = surveillanceHash({ snapshot, reason: "Initial local capture", evidence: null });
      await tx.surveillanceEntry.create({ data: { recordId: record.id, version: record.version, actorId: user.id, action: "CREATE", reason: "Initial local capture", snapshot, snapshotHash: hash } });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "SURVEILLANCE_CREATE", entityType: "SurveillanceRecord", entityId: record.id, afterHash: hash });
      return record;
    });
    return privateJson({ ...surveillanceDescriptor, record }, { status: 201 });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    await requirePermission("surveillance.read");
    const input = surveillanceChange.parse(await request.json());
    const user = await requirePermission(["REVIEW", "CLOSE", "REOPEN", "DUPLICATE"].includes(input.action) ? "surveillance.review" : "surveillance.record");
    const record = await db.$transaction(async tx => {
      const previous = await tx.surveillanceRecord.findFirst({ where: { id: input.id, facilityId: user.facilityId } });
      if (!previous) throw Object.assign(new Error("Record not found"), { status: 404 });
      if (previous.version !== input.version) throw Object.assign(new Error("Record changed. Refresh before continuing."), { status: 409 });
      assertSurveillanceAction(previous.status, input.action, previous.priority);
      const data: Prisma.SurveillanceRecordUncheckedUpdateManyInput = { version: { increment: 1 } };
      let evidence: Prisma.InputJsonObject | undefined;
      if (input.action === "UPDATE") {
        await checkPatient(tx, input.details.patientId, user.facilityId);
        data.details = input.details; data.patientId = input.details.patientId; data.priority = input.details.priority; data.status = "OPEN";
      } else if (input.action === "REVIEW") data.status = "REVIEWED";
      else if (input.action === "CLOSE") data.status = "CLOSED";
      else if (input.action === "REOPEN") { data.status = "OPEN"; data.duplicateOfId = null; }
      else if (input.action === "DUPLICATE") {
        const target = await tx.surveillanceRecord.findFirst({ where: { id: input.duplicateOfId, facilityId: user.facilityId, duplicateOfId: null } });
        if (!target || target.id === previous.id) throw Object.assign(new Error("Select a different original record from this facility"), { status: 422 });
        data.duplicateOfId = target.id; data.status = "CLOSED";
      } else if (input.action === "NOTIFY") {
        evidence = { ...input.notification, assurance: "STAFF_RECORDED_ONLY" };
      } else if (input.action === "ACKNOWLEDGE" || input.action === "ANNOTATE") {
        const entryId = input.action === "ACKNOWLEDGE" ? input.acknowledgement.notificationId : input.entryId;
        const entry = await tx.surveillanceEntry.findFirst({ where: { id: entryId, recordId: previous.id } });
        if (!entry) throw Object.assign(new Error("Referenced history entry not found on this record"), { status: 404 });
        if (input.action === "ACKNOWLEDGE") {
          if (entry.action !== "NOTIFY") throw Object.assign(new Error("Select a notification entry"), { status: 422 });
          const notification = manualNotification.parse(Object.fromEntries(Object.entries(entry.evidence as object).filter(([key]) => key !== "assurance")));
          if (new Date(input.acknowledgement.acknowledgedAt) < new Date(notification.notifiedAt)) throw Object.assign(new Error("Acknowledgement cannot precede the recorded notification"), { status: 422 });
          evidence = { ...input.acknowledgement, assurance: "STAFF_RECORDED_ONLY" };
        } else evidence = { entryId: input.entryId, annotation: "CORRECTION_OR_ADDITIONAL_CONTEXT" };
      }
      const changed = await tx.surveillanceRecord.updateMany({ where: { id: previous.id, facilityId: user.facilityId, version: input.version }, data });
      if (changed.count !== 1) throw Object.assign(new Error("Record changed. Refresh before continuing."), { status: 409 });
      const record = await tx.surveillanceRecord.findUniqueOrThrow({ where: { id: previous.id }, select: selection });
      const snapshot = { details: record.details, status: record.status, version: record.version, duplicateOfId: record.duplicateOfId };
      const hash = surveillanceHash({ snapshot, reason: input.reason, evidence: evidence || null });
      await tx.surveillanceEntry.create({ data: { recordId: record.id, version: record.version, actorId: user.id, action: input.action, reason: input.reason, snapshot: snapshot as Prisma.InputJsonObject, ...(evidence ? { evidence } : {}), snapshotHash: hash } });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: `SURVEILLANCE_${input.action}`, entityType: "SurveillanceRecord", entityId: record.id, beforeHash: surveillanceHash(previous.details), afterHash: hash });
      return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return privateJson({ ...surveillanceDescriptor, record });
  } catch (error) { return apiError(error); }
}
