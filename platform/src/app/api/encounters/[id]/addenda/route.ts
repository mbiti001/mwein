import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { addendumAuditFingerprint } from "@/lib/addendum-audit";
import { isRetryableTransactionConflict } from "@/lib/transaction-conflict";

const schema = z.object({
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(5).max(240),
  text: z.string().trim().min(5).max(5000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("encounter.write");
    const { id } = await params;
    const input = schema.parse(await request.json());
    const save = () => db.$transaction(async tx => {
      const encounter = await tx.encounter.findFirst({ where: { id, status: "SIGNED", visit: { facilityId: user.facilityId } } });
      if (!encounter) throw Object.assign(new Error("Only a signed encounter in this facility can receive an addendum"), { status: 409 });
      const existing = await tx.encounterAddendum.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { author: { select: { displayName: true } } },
      });
      if (existing) {
        if (existing.encounterId !== id || existing.authorId !== user.id || existing.reason !== input.reason || existing.text !== input.text)
          throw Object.assign(new Error("This addendum retry key belongs to a different signed-note request. Reload before submitting a new addendum."), { status: 409 });
        const receipt = await tx.auditEvent.findFirst({
          where: {
            facilityId: user.facilityId, userId: user.id,
            action: "ENCOUNTER_ADDENDUM_ADDED", entityType: "Encounter", entityId: id,
            afterHash: addendumAuditFingerprint(user.facilityId, encounter.visitId, existing),
          },
          select: { id: true },
        });
        if (!receipt)
          throw Object.assign(new Error("The prior addendum could not be confirmed from its audit receipt. It has not been resubmitted."), { status: 409 });
        return { addendum: existing, replayed: true };
      }
      const record = await tx.encounterAddendum.create({ data: { encounterId: id, authorId: user.id, idempotencyKey: input.idempotencyKey, reason: input.reason, text: input.text }, include: { author: { select: { displayName: true } } } });
      await appendAudit(tx, { userId: user.id, facilityId: user.facilityId, sessionId: user.sessionId, action: "ENCOUNTER_ADDENDUM_ADDED", entityType: "Encounter", entityId: id, reason: input.reason, afterHash: addendumAuditFingerprint(user.facilityId, encounter.visitId, record) });
      return { addendum: record, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    // Only retry known aborted transactions, including a competing key insert.
    // Ambiguous connection failures are returned for an explicit exact-key retry.
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await save();
        return privateJson(result, { status: result.replayed ? 200 : 201 });
      } catch (error) {
        if (attempt >= 2 || (!isRetryableTransactionConflict(error) && (error as { code?: string }).code !== "P2002")) throw error;
      }
    }
  } catch (error) { return apiError(error); }
}
