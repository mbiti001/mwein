import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

const inputSchema = z.object({
  clinicalStatus: z.enum(["ACTIVE", "INACTIVE", "RESOLVED", "ENTERED_IN_ERROR"]),
  reason: z.string().trim().min(3).max(500),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; problemId: string }> }) {
  try {
    const user = await requirePermission("encounter.write");
    const { id, problemId } = await params;
    const input = inputSchema.parse(await request.json());
    const existing = await db.patientProblem.findFirst({
      where: { id: problemId, patientId: id, facilityId: user.facilityId },
    });
    if (!existing) throw Object.assign(new Error("Patient problem not found"), { status: 404 });
    if (existing.clinicalStatus === input.clinicalStatus)
      throw Object.assign(new Error("The problem already has this status"), { status: 409 });
    const problem = await db.$transaction(async (tx) => {
      const updated = await tx.patientProblem.update({
        where: { id: problemId },
        data: {
          clinicalStatus: input.clinicalStatus,
          resolvedAt: input.clinicalStatus === "RESOLVED" ? new Date() : null,
        },
        include: { recordedBy: { select: { displayName: true } } },
      });
      await appendAudit(tx, {
        facilityId: user.facilityId,
        userId: user.id,
        sessionId: user.sessionId,
        action: "PATIENT_PROBLEM_STATUS_CHANGED",
        entityType: "PatientProblem",
        entityId: problemId,
        reason: input.reason,
        beforeHash: existing.clinicalStatus,
        afterHash: updated.clinicalStatus,
      });
      return updated;
    });
    return NextResponse.json({ problem });
  } catch (error) { return apiError(error); }
}
