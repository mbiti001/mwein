import { describe, expect, it } from "vitest";
import { assertDocumentEditable, parseDocumentPayload } from "./clinic-documents";
import { canonicalDocument, clinicDocumentHash } from "./clinic-document-integrity";

describe("clinic document signing", () => {
  it("allows incomplete drafts but refuses incomplete signed forms", () => {
    expect(parseDocumentPayload("SICK", {}).recommendation).toBe("");
    expect(() => parseDocumentPayload("SICK", {}, true)).toThrow("required before signing");
  });
  it("rejects invalid dates, reversed leave dates and unrecognized fields", () => {
    expect(() => parseDocumentPayload("SICK", { assessmentDate: "2026-02-30" })).toThrow();
    expect(() => parseDocumentPayload("SICK", { restFrom: "2026-09-25", restTo: "2026-09-24" })).toThrow("cannot precede");
    expect(() => parseDocumentPayload("GATE", { departureAt: "2026-09-25T25:00" })).toThrow("Invalid time");
    expect(() => parseDocumentPayload("GATE", { signature: "someone else" })).toThrow();
  });
  it("rejects edits after signing and stale versions", () => {
    expect(() => assertDocumentEditable("SIGNED", 2, 2)).toThrow("locked");
    expect(() => assertDocumentEditable("DRAFT", 2, 1)).toThrow("changed");
    expect(() => assertDocumentEditable("DRAFT", 2, 2)).not.toThrow();
  });
  it("hashes equivalent JSONB identically and detects altered content and signatures", () => {
    const record = { id: "document", facilityId: "facility", visitId: null, kind: "DELIVERY", reference: "ref", revision: 1, previousId: null, correctionReason: null, payload: { a: "item", b: "qty" }, context: { facilityName: "Mwein" }, signedById: "staff", signedAt: new Date("2026-09-25T10:00:00Z"), signerName: "Staff member", signerRoles: ["STOREKEEPER"], signerRegistration: null, signerSessionId: "session" };
    expect(canonicalDocument({ b: 1, a: [2, 3] })).toBe(canonicalDocument({ a: [2, 3], b: 1 }));
    expect(clinicDocumentHash({ ...record, payload: { b: "qty", a: "item" } })).toBe(clinicDocumentHash(record));
    for (const changed of [{ payload: { a: "other" } }, { facilityId: "other" }, { signerName: "Impersonator" }, { signedAt: new Date() }, { correctionReason: "altered" }]) expect(clinicDocumentHash({ ...record, ...changed })).not.toBe(clinicDocumentHash(record));
  });
});
