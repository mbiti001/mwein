import { recordDisclosure } from "@/lib/disclosure-audit";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError, privateJson } from "@/lib/http";

const inputSchema = z.object({
  description: z.string().trim().min(2).max(500),
  codeSystem: z.string().trim().min(2).max(80).default("ICD-11 MMS"),
  code: z.string().trim().max(80).optional(),
  foundationUri: z.string().trim().url().max(500).optional(),
  onsetDate: z.iso.date().optional(),
  notes: z.string().trim().max(1200).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("clinical.history.read");
    const { id } = await params;
    const problems = await db.patientProblem.findMany({
      where: { patientId: id, facilityId: user.facilityId },
      include: { recordedBy: { select: { displayName: true } } },
      orderBy: [{ clinicalStatus: "asc" }, { updatedAt: "desc" }],
    });
    await recordDisclosure(user, "PATIENT_PROBLEMS", [id, ...problems.map(item => item.id)]);
    return privateJson({ problems });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("encounter.write");
    const { id } = await params;
    const input = inputSchema.parse(await request.json());
    const patient = await db.patient.findFirst({ where: { id, facilityId: user.facilityId }, select: { id: true } });
    if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
    const problem = await db.$transaction(async (tx) => {
      const created = await tx.patientProblem.create({
        data: {
          facilityId: user.facilityId,
          patientId: id,
          description: input.description,
          codeSystem: input.codeSystem,
          code: input.code,
          foundationUri: input.foundationUri,
          onsetDate: input.onsetDate ? new Date(input.onsetDate) : undefined,
          notes: input.notes,
          recordedById: user.id,
        },
        include: { recordedBy: { select: { displayName: true } } },
      });
      await appendAudit(tx, {
        facilityId: user.facilityId,
        userId: user.id,
        sessionId: user.sessionId,
        action: "PATIENT_PROBLEM_RECORDED",
        entityType: "PatientProblem",
        entityId: created.id,
        afterHash: `${created.codeSystem}:${created.code || "UNCODED"}:${created.clinicalStatus}`,
      });
      return created;
    });
    return privateJson({ problem }, { status: 201 });
  } catch (error) { return apiError(error); }
}
