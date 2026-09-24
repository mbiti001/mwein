import { auditedOperationalJson } from "@/lib/audited-json";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { governanceGateDefinitions, governanceReadiness } from "@/lib/governance";
import { apiError } from "@/lib/http";

const gateCodes = governanceGateDefinitions.map((gate) => gate.code) as [string, ...string[]];
const inputSchema = z.object({
  gateCode: z.enum(gateCodes),
  status: z.enum(["PENDING", "BLOCKED", "APPROVED", "EXPIRED"]),
  owner: z.string().trim().min(2).max(160),
  evidenceReference: z.string().trim().min(3).max(800).optional(),
  notes: z.string().trim().max(2000).optional(),
  approvedAt: z.iso.datetime().optional(),
  reviewDueAt: z.iso.datetime().optional(),
}).superRefine((value, context) => {
  if (value.status === "APPROVED" && (!value.evidenceReference || !value.approvedAt))
    context.addIssue({ code: "custom", message: "Approval needs an evidence reference and approval time", path: ["evidenceReference"] });
  if (value.status === "APPROVED" && value.reviewDueAt && new Date(value.reviewDueAt) <= new Date())
    context.addIssue({ code: "custom", message: "The review due date must be in the future", path: ["reviewDueAt"] });
});

export async function GET() {
  try {
    const user = await requirePermission("admin.dashboard");
    const evidence = await db.governanceEvidence.findMany({
      where: { facilityId: user.facilityId },
      include: { updatedBy: { select: { displayName: true } } },
      orderBy: { gateCode: "asc" },
    });
    return await auditedOperationalJson(user, "admin/governance", governanceReadiness(evidence));
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requirePermission("admin.assign_governance");
    const input = inputSchema.parse(await request.json());
    const previous = await db.governanceEvidence.findUnique({
      where: { facilityId_gateCode: { facilityId: user.facilityId, gateCode: input.gateCode } },
    });
    const evidence = await db.$transaction(async (tx) => {
      const record = await tx.governanceEvidence.upsert({
        where: { facilityId_gateCode: { facilityId: user.facilityId, gateCode: input.gateCode } },
        update: {
          status: input.status,
          owner: input.owner,
          evidenceReference: input.evidenceReference,
          notes: input.notes,
          approvedAt: input.approvedAt ? new Date(input.approvedAt) : null,
          reviewDueAt: input.reviewDueAt ? new Date(input.reviewDueAt) : null,
          updatedById: user.id,
        },
        create: {
          facilityId: user.facilityId,
          gateCode: input.gateCode,
          status: input.status,
          owner: input.owner,
          evidenceReference: input.evidenceReference,
          notes: input.notes,
          approvedAt: input.approvedAt ? new Date(input.approvedAt) : null,
          reviewDueAt: input.reviewDueAt ? new Date(input.reviewDueAt) : null,
          updatedById: user.id,
        },
        include: { updatedBy: { select: { displayName: true } } },
      });
      await appendAudit(tx, {
        facilityId: user.facilityId,
        userId: user.id,
        sessionId: user.sessionId,
        action: "GOVERNANCE_EVIDENCE_UPDATED",
        entityType: "GovernanceEvidence",
        entityId: record.id,
        reason: input.notes,
        beforeHash: previous?.status || "UNRECORDED",
        afterHash: `${record.gateCode}:${record.status}:${record.evidenceReference || "NO_EVIDENCE"}`,
      });
      return record;
    });
    return NextResponse.json({ evidence });
  } catch (error) { return apiError(error); }
}
