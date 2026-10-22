import { describe, expect, it } from "vitest";
import { prescriptionCalculation, prescribingDefaultsSchema, readPrescribingDefaults } from "./prescribing-defaults";
import { prescriptionSchema } from "./consultation";
const defaults = { route: "Oral", frequencyPerDay: 2, durationDays: 3, doseUnit: "tablet", doseUnitsPerIssueUnit: 1, wholeIssueUnits: false };
describe("facility prescribing defaults", () => {
  it("does not invent defaults for missing or incomplete configuration", () => {
    expect(readPrescribingDefaults(null)).toBeNull();
    expect(readPrescribingDefaults({ route: "Oral" })).toBeNull();
    expect(prescriptionCalculation("1", "2", "3", null)).toBeNull();
  });
  it("uses one dose entry with an explicit unit and recalculates changed duration", () => {
    expect(prescriptionCalculation("0.5", "2", "3", defaults)).toEqual({ dose: "0.5 tablet", doseQuantity: 0.5, quantity: 3 });
    expect(prescriptionCalculation("0.5 tablet", "2", "6", defaults)?.quantity).toBe(6);
    expect(prescriptionCalculation("100 mg", "2", "3", defaults)).toBeNull();
  });
  it("converts liquid doses to whole bottles only when configured", () => {
    const liquid = { ...defaults, doseUnit: "mL", doseUnitsPerIssueUnit: 100, wholeIssueUnits: true };
    expect(prescriptionCalculation("5 mL", "3", "7", liquid)).toEqual({ dose: "5 mL", doseQuantity: 0.05, quantity: 2 });
    expect(prescriptionCalculation("5", "3", "7", { ...liquid, wholeIssueUnits: false })?.quantity).toBe(1.05);
  });
  it("rejects invalid quantities, precision loss and fractional schedules", () => {
    for (const [dose, frequency, days] of [["", "2", "3"], ["0", "2", "3"], ["1", "", "3"], ["1", "1.5", "3"], ["1", "2", "0"], ["1000", "24", "3650"]]) expect(prescriptionCalculation(dose, frequency, days, defaults)).toBeNull();
    expect(prescriptionCalculation("1", "2", "3", { ...defaults, doseUnitsPerIssueUnit: 3 })).toBeNull();
    expect(prescribingDefaultsSchema.safeParse({ ...defaults, doseUnitsPerIssueUnit: 0 }).success).toBe(false);
  });
  it("accepts a prescription without diagnosis or indication while retaining quantity review", () => {
    const line = { medicineCode: "SYNTH-A", dose: "1 tablet", doseQuantity: 1, route: "Oral", frequency: "Twice daily", frequencyPerDay: 2, duration: "3 days", durationDays: 3, startDate: "2026-10-22", quantity: 6, quantityConfirmed: true, instructions: "1 tablet; Oral; Twice daily; 3 days.", calculationDefaults: defaults };
    const input = { idempotencyKey: "00000000-0000-4000-8000-000000000001", prescriptions: [line] };
    expect(prescriptionSchema.parse(input).prescriptions[0].indication).toBe("");
    expect(prescriptionSchema.safeParse({ ...input, prescriptions: [{ ...line, quantityConfirmed: false }] }).success).toBe(false);
  });
});
