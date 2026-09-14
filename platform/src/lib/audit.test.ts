import { describe, expect, it } from "vitest";
import { AUDIT_CHAIN_VERSION, AUDIT_GENESIS_HASH, auditEventHash, verifyAuditChain } from "./audit";

function event(sequence: bigint, previousEventHash: string) {
  const record = {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    facilityId: "11111111-1111-4111-8111-111111111111",
    chainVersion: AUDIT_CHAIN_VERSION,
    sequence,
    previousEventHash,
    occurredAt: new Date(`2026-09-11T00:00:0${sequence}.000Z`),
    userId: "22222222-2222-4222-8222-222222222222",
    action: "TESTED",
    entityType: "Record",
    entityId: String(sequence),
  };
  return { ...record, eventHash: auditEventHash(record) };
}

describe("facility audit chain", () => {
  it("verifies ordered, linked and correctly hashed events", () => {
    const first = event(1n, AUDIT_GENESIS_HASH);
    const second = event(2n, first.eventHash);
    expect(verifyAuditChain([second, first], second.eventHash)).toMatchObject({ valid: true, eventCount: 2 });
  });

  it("detects tampering and missing positions", () => {
    const first = event(1n, AUDIT_GENESIS_HASH);
    const third = { ...event(3n, first.eventHash), reason: "altered after hashing" };
    const result = verifyAuditChain([first, third]);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("Expected sequence 2");
    expect(result.errors.join(" ")).toContain("Event hash mismatch");
  });
});
