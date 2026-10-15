import { describe, expect, it, vi } from "vitest";
import { allocateDocumentReference, documentReference, documentYear, retryDocumentTransaction } from "./document-numbering";

describe("document serial allocation", () => {
  it("uses the facility year at the Nairobi new-year boundary", () => {
    expect(documentYear("Africa/Nairobi", new Date("2026-12-31T20:59:59Z"))).toBe(2026);
    expect(documentYear("Africa/Nairobi", new Date("2026-12-31T21:00:00Z"))).toBe(2027);
    expect(documentYear("America/New_York", new Date("2026-12-31T21:00:00Z"))).toBe(2026);
    expect(() => documentYear("invalid-zone")).toThrow();
  });
  it("pads without truncating large sequence values", () => {
    expect(documentReference("MMS", "SICK", 2026, 1n)).toBe("MMS-SICK-2026-000001");
    expect(documentReference("MMS", "GATE", 2026, 1000001n)).toBe("MMS-GATE-2026-1000001");
    expect(documentReference("MMS", "DELIVERY", 2026, 9007199254740993n)).toMatch(/9007199254740993$/);
    expect(() => documentReference("MMS", "SICK", 2026, 0n)).toThrow();
  });
  it("allocates on the provided transaction with distinct facility/type/year keys", async () => {
    const upsert = vi.fn().mockResolvedValue({ nextValue: 2n });
    const tx = { referenceSequence: { upsert } } as any;
    for (const kind of ["SICK", "MATERNITY", "DELIVERY", "GATE"] as const) {
      expect(await allocateDocumentReference(tx, { id: "facility", code: "MMS", timezone: "Africa/Nairobi" }, kind, new Date("2026-12-31T21:00:00Z"))).toBe(`MMS-${kind}-2027-000001`);
      expect(upsert).toHaveBeenLastCalledWith({ where: { facilityId_kind_year: { facilityId: "facility", kind: `CLINIC_DOCUMENT_${kind}`, year: 2027 } }, create: { facilityId: "facility", kind: `CLINIC_DOCUMENT_${kind}`, year: 2027, nextValue: 2n }, update: { nextValue: { increment: 1 } } });
    }
  });
  it("retries the whole transaction for serialization and uniqueness races, with a bound", async () => {
    const operation = vi.fn().mockRejectedValueOnce({ code: "P2034" }).mockRejectedValueOnce({ code: "P2002" }).mockResolvedValue("same saved document");
    expect(await retryDocumentTransaction(operation)).toBe("same saved document");
    const blocked = vi.fn().mockRejectedValue({ code: "P2034" });
    await expect(retryDocumentTransaction(blocked)).rejects.toMatchObject({ code: "P2034" }); expect(blocked).toHaveBeenCalledTimes(4);
    const auditFailure = vi.fn().mockRejectedValue(new Error("audit failed"));
    await expect(retryDocumentTransaction(auditFailure)).rejects.toThrow("audit failed"); expect(auditFailure).toHaveBeenCalledTimes(1);
  });
});
