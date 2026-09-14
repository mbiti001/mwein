import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

const createSchema = z.object({ action: z.literal("CREATE"), kind: z.enum(["BACKUP", "RESTORE_DRILL", "AUDIT_EXPORT", "INCIDENT", "DOWNTIME_REHEARSAL"]), status: z.enum(["SUCCESS", "FAILURE", "OPEN", "RESOLVED"]), title: z.string().trim().min(5).max(180), occurredAt: z.iso.datetime({ offset: true }), evidenceReference: z.string().trim().min(5).max(800).optional(), notes: z.string().trim().max(2000).optional(), nextReviewAt: z.iso.datetime({ offset: true }).optional() }).superRefine((value, context) => { if (["SUCCESS", "RESOLVED"].includes(value.status) && !value.evidenceReference) context.addIssue({ code: "custom", path: ["evidenceReference"], message: "Successful or resolved evidence requires a retained reference" }); });
const verifySchema = z.object({ action: z.literal("VERIFY"), id: z.uuid(), note: z.string().trim().min(5).max(500) });
const schema = z.union([createSchema, verifySchema]);

export async function GET() {
  try { const user = await requirePermission("admin.operations"); const records = await db.operationsEvidence.findMany({ where: { facilityId: user.facilityId }, include: { recordedBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } }, orderBy: { occurredAt: "desc" }, take: 100 }); return NextResponse.json({ records }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("admin.operations"); const input = schema.parse(await request.json());
    const record = await db.$transaction(async tx => {
      if (input.action === "CREATE") {
        const created = await tx.operationsEvidence.create({ data: { facilityId: user.facilityId, kind: input.kind, status: input.status, title: input.title, occurredAt: new Date(input.occurredAt), evidenceReference: input.evidenceReference, notes: input.notes, nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null, recordedById: user.id }, include: { recordedBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } } });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "OPERATIONS_EVIDENCE_RECORDED", entityType: "OperationsEvidence", entityId: created.id, reason: input.notes, afterHash: `${input.kind}:${input.status}:${input.evidenceReference || "NO_REFERENCE"}` }); return created;
      }
      const current = await tx.operationsEvidence.findFirst({ where: { id: input.id, facilityId: user.facilityId } });
      if (!current) throw Object.assign(new Error("Operations evidence not found"), { status: 404 });
      if (current.recordedById === user.id) throw Object.assign(new Error("A different administrator must verify this evidence"), { status: 409 });
      if (current.verifiedAt) throw Object.assign(new Error("This evidence is already verified"), { status: 409 });
      const verified = await tx.operationsEvidence.update({ where: { id: current.id }, data: { verifiedById: user.id, verifiedAt: new Date() }, include: { recordedBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } } });
      await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "OPERATIONS_EVIDENCE_VERIFIED", entityType: "OperationsEvidence", entityId: verified.id, reason: input.note, afterHash: `${verified.kind}:${verified.status}:${verified.evidenceReference || "NO_REFERENCE"}` }); return verified;
    });
    return NextResponse.json({ record });
  } catch (error) { return apiError(error); }
}
