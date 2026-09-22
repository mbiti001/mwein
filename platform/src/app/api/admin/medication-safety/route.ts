import { auditedOperationalJson } from "@/lib/audited-json";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { medicationSafetyRuleContentSchema } from "@/lib/medication-safety";

const concept = z.string().trim().min(2).max(160).transform(value => value.toLowerCase());
const createSchema = z.object({
  action: z.literal("CREATE_DRAFT"), code: z.string().trim().min(3).max(80).transform(value => value.toUpperCase()),
  version: z.string().trim().min(1).max(40), severity: z.enum(["WARNING", "HARD_STOP"]),
  primaryConceptId: concept, interactingConceptId: concept.optional(), sourceReference: z.string().trim().min(8).max(800),
  rule: medicationSafetyRuleContentSchema,
}).superRefine((value, context) => {
  if (value.rule.kind === "INTERACTION" && !value.interactingConceptId) context.addIssue({ code: "custom", path: ["interactingConceptId"], message: "An interacting medication concept is required" });
});
const statusSchema = z.object({ action: z.enum(["APPROVE", "RETIRE"]), id: z.uuid(), reason: z.string().trim().min(10).max(500) });
const requestSchema = z.union([createSchema, statusSchema]);

export async function GET() {
  try {
    const user = await requirePermission("admin.clinical_safety");
    const rules = await db.medicationSafetyRule.findMany({ where: { facilityId: user.facilityId }, include: { approvedBy: { select: { displayName: true } } }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] });
    return await auditedOperationalJson(user, "admin/medication-safety", { rules });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("admin.clinical_safety");
    const input = requestSchema.parse(await request.json());
    const rule = await db.$transaction(async tx => {
      if (input.action === "CREATE_DRAFT") {
        const saved = await tx.medicationSafetyRule.create({ data: {
          facilityId: user.facilityId, code: input.code, kind: input.rule.kind, severity: input.severity, status: "DRAFT",
          primaryConceptId: input.primaryConceptId, interactingConceptId: input.interactingConceptId,
          sourceReference: input.sourceReference, version: input.version, rule: input.rule as Prisma.InputJsonValue,
        } });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "MEDICATION_SAFETY_RULE_DRAFTED", entityType: "MedicationSafetyRule", entityId: saved.id, afterHash: `${saved.code}:${saved.version}` });
        return saved;
      }
      const current = await tx.medicationSafetyRule.findFirst({ where: { id: input.id, facilityId: user.facilityId } });
      if (!current) throw Object.assign(new Error("Medication safety rule not found"), { status: 404 });
      if (input.action === "APPROVE") {
        if (current.status !== "DRAFT") throw Object.assign(new Error("Only a draft rule can be approved"), { status: 409 });
        const author = await tx.auditEvent.findFirst({ where: { facilityId: user.facilityId, entityType: "MedicationSafetyRule", entityId: current.id, action: "MEDICATION_SAFETY_RULE_DRAFTED" }, orderBy: { occurredAt: "asc" } });
        if (author?.userId === user.id) throw Object.assign(new Error("A second medical director must review and approve this rule"), { status: 409 });
        const saved = await tx.medicationSafetyRule.update({ where: { id: current.id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date(), activeFrom: new Date() } });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "MEDICATION_SAFETY_RULE_APPROVED", entityType: "MedicationSafetyRule", entityId: saved.id, reason: input.reason, beforeHash: current.status, afterHash: saved.status });
        return saved;
      }
      if (current.status === "RETIRED") throw Object.assign(new Error("This rule is already retired"), { status: 409 });
      const saved = await tx.medicationSafetyRule.update({ where: { id: current.id }, data: { status: "RETIRED", activeTo: new Date() } });
      await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "MEDICATION_SAFETY_RULE_RETIRED", entityType: "MedicationSafetyRule", entityId: saved.id, reason: input.reason, beforeHash: current.status, afterHash: saved.status });
      return saved;
    });
    return NextResponse.json({ rule });
  } catch (error) { return apiError(error); }
}
