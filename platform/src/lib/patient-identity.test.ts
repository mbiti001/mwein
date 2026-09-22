import { describe, expect, it } from "vitest";
import { identityInput, identitySnapshot, canReverseIdentity } from "./patient-identity";
const patient = { givenName: "Test", middleName: null, familyName: "Patient", fullName: "Test Patient", normalizedName: "test patient", dateOfBirth: null, estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", identityStatus: "DOCUMENTED" };
const input = { givenName: "Test", familyName: "Patient", estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", identifierType: "OTHER", identifierValue: "TEST-ONLY", evidenceType: "PATIENT_DOCUMENT", evidenceReference: "TEST-EVIDENCE", reason: "Reviewed identity correction" };
describe("identity provenance", () => {
  it("snapshots dates consistently", () => expect(identitySnapshot({ ...patient, dateOfBirth: new Date("2000-01-01") }).dateOfBirth).toBe("2000-01-01T00:00:00.000Z"));
  it("allows reversal only if demographics still match", () => {
    expect(canReverseIdentity(patient, identitySnapshot(patient))).toBe(true);
    expect(canReverseIdentity({ ...patient, givenName: "Changed" }, identitySnapshot(patient))).toBe(false);
  });
  it("requires evidence and exactly one age source", () => {
    expect(identityInput.safeParse(input).success).toBe(true);
    expect(identityInput.safeParse({ ...input, dateOfBirth: "2000-01-01" }).success).toBe(false);
    expect(identityInput.safeParse({ ...input, estimatedAgeYears: undefined }).success).toBe(false);
    expect(identityInput.safeParse({ ...input, evidenceReference: "" }).success).toBe(false);
  });
  it("rejects future dates", () => expect(identityInput.safeParse({ ...input, estimatedAgeYears: undefined, dateOfBirth: "2999-01-01" }).success).toBe(false));
});
