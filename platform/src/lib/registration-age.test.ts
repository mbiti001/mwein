import { describe, expect, it } from "vitest";
import { patientRegistrationSchema } from "./domain";

const standard = {
  givenName: "Synthetic", familyName: "Patient", sexAtBirth: "UNKNOWN",
  phone: "+254700000001", county: "Busia", subcounty: "Nambale",
  treatmentConsent: true, electronicRecordConsent: true,
};

describe("registration estimated age records only deliberate numeric input", () => {
  for (const mode of ["STANDARD", "GUARDIAN_ASSISTED", "EMERGENCY_UNKNOWN"]) {
    it.each([null, "", "  ", false, true, [], [0], [30], {}, "not an age", -1, 121, 1.5, Infinity, NaN].map(value => [value]))(
      `${mode} rejects invalid supplied age %j`, (estimatedAgeYears) => {
        expect(patientRegistrationSchema.safeParse({ ...standard, registrationMode: mode,
          representativeName: "Synthetic Parent", representativeRelationship: "Parent",
          emergencyReason: "Unidentified patient needs immediate care", lawfulBasis: "VITAL_INTERESTS",
          estimatedAgeYears }).success).toBe(false);
      });
  }
  it.each([[0, 0], ["0", 0], [" 30 ", 30], [120, 120], ["120", 120]])("preserves explicit %j as %j", (input, expected) => {
    const result = patientRegistrationSchema.parse({ ...standard, estimatedAgeYears: input });
    expect(result.estimatedAgeYears).toBe(expected);
  });
  it("requires an age or date of birth for standard registration", () => {
    expect(patientRegistrationSchema.safeParse(standard).success).toBe(false);
    expect(patientRegistrationSchema.parse({ ...standard, dateOfBirth: "1990-01-01" }).estimatedAgeYears).toBeUndefined();
  });
  it("preserves unknown age for emergency registration", () => {
    const result = patientRegistrationSchema.parse({ registrationMode: "EMERGENCY_UNKNOWN", lawfulBasis: "VITAL_INTERESTS", emergencyReason: "Unidentified patient needs immediate care" });
    expect(result.estimatedAgeYears).toBeUndefined();
  });
});
