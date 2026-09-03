import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

export async function appendAudit(tx: Prisma.TransactionClient, input: { userId?: string; action: string; entityType: string; entityId: string; reason?: string; beforeHash?: string; afterHash?: string }) {
  const previousEventHash = (await tx.auditEvent.findFirst({ orderBy: { occurredAt: "desc" }, select: { eventHash: true } }))?.eventHash || "GENESIS";
  const id = randomUUID();
  const occurredAt = new Date();
  const eventHash = createHash("sha256").update([id, previousEventHash, occurredAt.toISOString(), input.userId || "SYSTEM", input.action, input.entityType, input.entityId, input.reason || "", input.beforeHash || "", input.afterHash || ""].join("\u001f")).digest("hex");
  return tx.auditEvent.create({ data: { id, occurredAt, previousEventHash, eventHash, ...input } });
}
