import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { recordClinicalAccess } from "@/lib/clinical-access";

const consentTypes = ["TREATMENT", "ELECTRONIC_RECORD", "MESSAGING", "RESEARCH", "DATA_SHARING"] as const;

const changeSchema = z.object({
  action: z.enum(["GRANT", "WITHDRAW"]),
  type: z.enum(consentTypes),
  noticeVersion: z.string().trim().min(1).max(40),
  lawfulBasis: z.enum(["CONSENT", "VITAL_INTERESTS", "LEGAL_OBLIGATION", "PROVISION_OF_HEALTH_CARE"]),
  representativeName: z.string().trim().min(2).max(160).optional(),
  representativeRelationship: z.string().trim().min(2).max(80).optional(),
  reason: z.string().trim().min(5).max(500),
}).superRefine((value, context) => {
  if (value.representativeName && !value.representativeRelationship)
    context.addIssue({ code: "custom", path: ["representativeRelationship"], message: "Representative relationship is required" });
  if (value.type === "MESSAGING" && value.action === "GRANT" && value.lawfulBasis !== "CONSENT")
    context.addIssue({ code: "custom", path: ["lawfulBasis"], message: "Messaging requires affirmative consent" });
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("patient.read");
    const { id } = await context.params;
    const patient = await db.patient.findFirst({
      where: { id, facilityId: user.facilityId },
      select: { id: true, consents: { orderBy: { recordedAt: "desc" } } },
    });
    if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
    await recordClinicalAccess(user, "PATIENT_CONSENTS", [{ type: "Patient", id }]);
    return NextResponse.json({ consents: patient.consents }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("patient.create");
    const { id } = await context.params;
    const input = changeSchema.parse(await request.json());
    const patient = await db.patient.findFirst({ where: { id, facilityId: user.facilityId }, select: { id: true } });
    if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
    const changedAt = new Date();
    const consent = await db.$transaction(async (tx) => {
      await tx.consent.updateMany({
        where: { patientId: id, type: input.type, withdrawnAt: null },
        data: { withdrawnAt: changedAt, withdrawnById: user.id },
      });
      const record = input.action === "GRANT" ? await tx.consent.create({ data: {
        patientId: id,
        type: input.type,
        granted: true,
        recordedById: user.id,
        noticeVersion: input.noticeVersion,
        lawfulBasis: input.lawfulBasis,
        representativeName: input.representativeName,
        representativeRelationship: input.representativeRelationship,
        reason: input.reason,
      } }) : null;
      await appendAudit(tx, {
        userId: user.id,
        action: input.action === "GRANT" ? "CONSENT_GRANTED" : "CONSENT_WITHDRAWN",
        entityType: "Patient",
        entityId: id,
        reason: JSON.stringify({ type: input.type, noticeVersion: input.noticeVersion, lawfulBasis: input.lawfulBasis, representative: Boolean(input.representativeName), reason: input.reason }),
      });
      return record;
    });
    return NextResponse.json({ consent, status: input.action === "GRANT" ? "ACTIVE" : "WITHDRAWN" });
  } catch (error) { return apiError(error); }
}
