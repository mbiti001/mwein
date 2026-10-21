import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { addendumAuditFingerprint } from "@/lib/addendum-audit";

const schema = z.object({ reason: z.string().trim().min(5).max(240), text: z.string().trim().min(5).max(5000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("encounter.write");
    const { id } = await params;
    const input = schema.parse(await request.json());
    const addendum = await db.$transaction(async tx => {
      const encounter = await tx.encounter.findFirst({ where: { id, status: "SIGNED", visit: { facilityId: user.facilityId } } });
      if (!encounter) throw Object.assign(new Error("Only a signed encounter in this facility can receive an addendum"), { status: 409 });
      const record = await tx.encounterAddendum.create({ data: { encounterId: id, authorId: user.id, reason: input.reason, text: input.text }, include: { author: { select: { displayName: true } } } });
      await appendAudit(tx, { userId: user.id, facilityId: user.facilityId, sessionId: user.sessionId, action: "ENCOUNTER_ADDENDUM_ADDED", entityType: "Encounter", entityId: id, reason: input.reason, afterHash: addendumAuditFingerprint(user.facilityId, encounter.visitId, record) });
      return record;
    });
    return privateJson({ addendum }, { status: 201 });
  } catch (error) { return apiError(error); }
}
