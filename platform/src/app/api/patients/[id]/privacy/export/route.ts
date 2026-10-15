import { z } from "zod";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("privacy.manage");
    const { id } = await params;
    const { requestId, previousResponseReference, regenerationReason } = z.object({ requestId: z.uuid(), previousResponseReference: z.string().max(100).optional(), regenerationReason: z.string().trim().min(10).max(500).optional() }).strict().parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "DataSubjectRequest" WHERE id = ${requestId}::uuid AND "patientId" = ${id}::uuid AND "facilityId" = ${user.facilityId}::uuid FOR UPDATE`;
      const rightsRequest = await tx.dataSubjectRequest.findFirst({ where: { id: requestId, patientId: id, facilityId: user.facilityId } });
      if (!rightsRequest) throw Object.assign(new Error("Data-subject request not found"), { status: 404 });
      if (!["ACCESS", "PORTABLE_EXPORT"].includes(rightsRequest.type) || rightsRequest.status !== "IN_REVIEW")
        throw Object.assign(new Error("Only an identity-verified, in-review access or portable-export request can generate an export"), { status: 409 });
      if (rightsRequest.responseEvidenceReference ? rightsRequest.responseEvidenceReference !== previousResponseReference || !regenerationReason : Boolean(previousResponseReference))
        throw Object.assign(new Error("An export may already be prepared. Reload the request; regenerating requires its current response reference and a reason"), { status: 409 });
      const patient = await tx.patient.findFirst({
        where: { id, facilityId: user.facilityId },
        include: {
          identifiers: true, contacts: true, addresses: true, consents: { orderBy: { recordedAt: "asc" } }, allergies: true,
          problems: { orderBy: { createdAt: "asc" } }, appointments: { orderBy: { scheduledAt: "asc" } }, referrals: { orderBy: { createdAt: "asc" } },
          visits: { orderBy: { arrivedAt: "asc" }, include: { triage: { include: { observations: true } }, encounters: { include: { diagnoses: true, addenda: true }, orderBy: { createdAt: "asc" } }, orders: { include: { laboratory: { include: { result: { include: { items: true } } } }, imaging: { include: { result: true } }, prescription: { include: { dispensations: { include: { items: true } } } } }, orderBy: { requestedAt: "asc" } } } },
        },
      });
      if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
      const payload = { exportVersion: "MWEIN-PATIENT-1", generatedAt: new Date().toISOString(), facility: { code: user.facility.code, name: user.facility.name }, request: { id: rightsRequest.id, type: rightsRequest.type, requestedAt: rightsRequest.requestedAt }, patient };
      const audit = await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "PATIENT_DATA_EXPORTED", entityType: "Patient", entityId: id, beforeHash: rightsRequest.responseEvidenceReference || undefined, afterHash: auditValueFingerprint(payload), reason: regenerationReason });
      await tx.dataSubjectRequest.update({ where: { id: rightsRequest.id }, data: { responsePreparedAt: new Date(payload.generatedAt), responseEvidenceReference: `audit:${audit.id}`, updatedById: user.id } });
      return { payload, filename: `mwein-patient-export-${rightsRequest.id}.json` };
    });
    return new Response(JSON.stringify(result.payload, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}"`, "Cache-Control": "no-store, private", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error); }
}
