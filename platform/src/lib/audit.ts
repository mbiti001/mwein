import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const AUDIT_CHAIN_VERSION = 2;
export const AUDIT_GENESIS_HASH = "GENESIS";

export type AuditHashInput = {
  id: string;
  facilityId: string;
  chainVersion: number;
  sequence: bigint | number | string;
  previousEventHash: string;
  occurredAt: Date | string;
  userId?: string | null;
  sessionId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  beforeHash?: string | null;
  afterHash?: string | null;
};

export type AuditAppendInput = {
  facilityId?: string;
  userId?: string;
  sessionId?: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  beforeHash?: string;
  afterHash?: string;
};

export function auditEventHash(input: AuditHashInput) {
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt.toISOString() : new Date(input.occurredAt).toISOString();
  return createHash("sha256").update([
    input.id,
    input.facilityId,
    String(input.chainVersion),
    String(input.sequence),
    input.previousEventHash,
    occurredAt,
    input.userId || "SYSTEM",
    input.sessionId || "NO_SESSION",
    input.action,
    input.entityType,
    input.entityId,
    input.reason || "",
    input.beforeHash || "",
    input.afterHash || "",
  ].join("\u001f")).digest("hex");
}

export function verifyAuditChain(events: Array<AuditHashInput & { eventHash: string }>, expectedHeadHash?: string) {
  const ordered = [...events].sort((left, right) => left.sequence < right.sequence ? -1 : left.sequence > right.sequence ? 1 : 0);
  const errors: string[] = [];
  let previousEventHash = AUDIT_GENESIS_HASH;
  let expectedSequence = 1n;
  for (const event of ordered) {
    const sequence = BigInt(event.sequence);
    if (event.chainVersion !== AUDIT_CHAIN_VERSION)
      errors.push(`Unsupported chain version at sequence ${sequence}`);
    if (sequence !== expectedSequence)
      errors.push(`Expected sequence ${expectedSequence}, received ${sequence}`);
    if (event.previousEventHash !== previousEventHash)
      errors.push(`Previous hash mismatch at sequence ${sequence}`);
    if (auditEventHash(event) !== event.eventHash)
      errors.push(`Event hash mismatch at sequence ${sequence}`);
    previousEventHash = event.eventHash;
    expectedSequence = sequence + 1n;
  }
  if (expectedHeadHash && previousEventHash !== expectedHeadHash)
    errors.push("Chain head does not match the last event");
  return { valid: errors.length === 0, errors, eventCount: ordered.length, headHash: previousEventHash };
}

export async function appendAudit(tx: Prisma.TransactionClient, input: AuditAppendInput) {
  let facilityId = input.facilityId;
  if (!facilityId && input.userId) {
    const actor = await tx.user.findUnique({ where: { id: input.userId }, select: { facilityId: true } });
    facilityId = actor?.facilityId;
  }
  if (!facilityId) throw new Error("A facility is required for every audit event");

  const occurredAt = new Date();
  await tx.auditChainHead.upsert({
    where: { facilityId },
    update: {},
    create: { facilityId, chainVersion: AUDIT_CHAIN_VERSION, sequence: 0n, eventHash: AUDIT_GENESIS_HASH, updatedAt: occurredAt },
  });
  const heads = await tx.$queryRaw<Array<{ chainVersion: number; sequence: bigint; eventHash: string }>>`
    SELECT "chainVersion", "sequence", "eventHash"
    FROM "AuditChainHead"
    WHERE "facilityId" = ${facilityId}::uuid
    FOR UPDATE
  `;
  const head = heads[0];
  if (!head || head.chainVersion !== AUDIT_CHAIN_VERSION)
    throw new Error("The facility audit chain is unavailable or uses an unsupported version");

  const id = randomUUID();
  const sequence = BigInt(head.sequence) + 1n;
  const eventHash = auditEventHash({
    ...input,
    id,
    facilityId,
    chainVersion: AUDIT_CHAIN_VERSION,
    sequence,
    previousEventHash: head.eventHash,
    occurredAt,
  });
  const event = await tx.auditEvent.create({
    data: {
      id, facilityId, chainVersion: AUDIT_CHAIN_VERSION, sequence,
      previousEventHash: head.eventHash, eventHash, occurredAt,
      userId: input.userId, sessionId: input.sessionId, action: input.action,
      entityType: input.entityType, entityId: input.entityId, reason: input.reason,
      beforeHash: input.beforeHash, afterHash: input.afterHash,
    },
  });
  await tx.auditChainHead.update({
    where: { facilityId },
    data: { sequence, eventHash, chainVersion: AUDIT_CHAIN_VERSION },
  });
  return event;
}
