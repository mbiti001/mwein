import { describe, expect, it } from "vitest";
import { evaluateMedicationSafety } from "./medication-safety";

const rule = (overrides: Partial<Parameters<typeof evaluateMedicationSafety>[0][number]> = {}) => ({
  id: "rule-1", code: "AMOX-ALLERGY", kind: "ALLERGY", severity: "HARD_STOP", status: "APPROVED",
  primaryConceptId: "amoxicillin", interactingConceptId: null, version: "1", rule: { kind: "ALLERGY", message: "Recorded allergy matches this medicine." }, ...overrides,
});

describe("medication safety rules", () => {
  it("ignores draft rules", () => {
    expect(evaluateMedicationSafety([rule({ status: "DRAFT" })], { medicationConceptId: "amoxicillin", patientAllergyConcepts: ["amoxicillin"], activeMedicationConcepts: [] })).toEqual([]);
  });
  it("returns a hard stop only for an approved exact allergy concept", () => {
    const result = evaluateMedicationSafety([rule()], { medicationConceptId: "amoxicillin", patientAllergyConcepts: ["amoxicillin"], activeMedicationConcepts: [] });
    expect(result[0]).toMatchObject({ severity: "HARD_STOP", outcome: "BLOCK", warningCode: "AMOX-ALLERGY" });
  });
  it("marks a dose check unavailable when structured dose data is absent", () => {
    const result = evaluateMedicationSafety([rule({ kind: "DOSE_LIMIT", severity: "WARNING", rule: { kind: "DOSE_LIMIT", message: "Daily quantity exceeds the approved limit.", maxDailyQuantity: 4 } })], { medicationConceptId: "amoxicillin", patientAllergyConcepts: [], activeMedicationConcepts: [] });
    expect(result[0].outcome).toBe("UNAVAILABLE");
  });
});
