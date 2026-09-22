import { describe, expect, it } from "vitest";
import { auditEntitySetFingerprint, auditValueFingerprint } from "./audit";

describe("auditEntitySetFingerprint", () => {
  it("is stable regardless of result order and duplicate identifiers", () => {
    expect(auditEntitySetFingerprint(["patient-b", "patient-a", "patient-a"]))
      .toBe(auditEntitySetFingerprint(["patient-a", "patient-b"]));
  });

  it("records the unique result count without exposing identifiers", () => {
    const fingerprint = auditEntitySetFingerprint(["sensitive-patient-id"]);
    expect(fingerprint).toMatch(/^1:[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain("sensitive-patient-id");
  });

  it("fingerprints exported values without placing them in the audit record", () => {
    const fingerprint = auditValueFingerprint({ fullName: "Sensitive Name" });
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain("Sensitive Name");
  });
});
