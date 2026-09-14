import { describe, expect, it } from "vitest";
import {
  dispensingBalance,
  isEquivalentMedication,
  planDispensingAllocation,
  planFefoAllocation,
} from "./pharmacy";

describe("partial dispensing", () => {
  it("keeps the outstanding balance active", () => {
    expect(dispensingBalance(20, 0, 10)).toEqual({
      cumulativeDispensed: 10,
      remainingAfter: 10,
      complete: false,
    });
  });

  it("completes a prescription over multiple supplies", () => {
    expect(dispensingBalance(20, 10, 10)).toEqual({
      cumulativeDispensed: 20,
      remainingAfter: 0,
      complete: true,
    });
  });

  it("rejects supply above the outstanding quantity", () => {
    expect(() => dispensingBalance(20, 10, 11)).toThrow(
      "outstanding quantity of 10",
    );
  });
});

describe("FEFO batch allocation", () => {
  const batches = [
    { id: "early", batchNumber: "B-001", expiryDate: "2026-10-01", quantityAvailable: 4 },
    { id: "later", batchNumber: "B-002", expiryDate: "2027-01-01", quantityAvailable: 10 },
  ];

  it("uses the earliest-expiring stock first and spans batches when needed", () => {
    expect(planFefoAllocation(batches, 6).map(({ id, quantity }) => ({ id, quantity }))).toEqual([
      { id: "early", quantity: 4 },
      { id: "later", quantity: 2 },
    ]);
  });

  it("rejects a quantity above available stock", () => {
    expect(() => planFefoAllocation(batches, 15)).toThrow("Available: 14");
  });

  it("marks a later preferred batch as a FEFO override", () => {
    expect(planDispensingAllocation(batches, 6, "later")).toMatchObject({
      fefoOverridden: true,
      allocation: [{ id: "later", quantity: 6 }],
      standardAllocation: [
        { id: "early", quantity: 4 },
        { id: "later", quantity: 2 },
      ],
    });
  });

  it("does not mark the normal first batch as an override", () => {
    expect(planDispensingAllocation(batches, 3, "early").fefoOverridden).toBe(false);
  });

  it("rejects an unavailable preferred batch", () => {
    expect(() => planDispensingAllocation(batches, 3, "missing")).toThrow(
      "not available",
    );
  });
});

describe("medicine substitution equivalence", () => {
  const prescribed = {
    medicationConceptId: "paracetamol",
    genericName: "Paracetamol",
    strength: "500 mg",
    dosageForm: "Tablet",
  };

  it("allows a different product with the same concept, strength and form", () => {
    expect(isEquivalentMedication(prescribed, {
      medicationConceptId: "PARACETAMOL",
      genericName: "Acetaminophen",
      strength: "500 MG",
      dosageForm: " tablet ",
    })).toBe(true);
  });

  it("rejects a different strength or dosage form", () => {
    expect(isEquivalentMedication(prescribed, { ...prescribed, strength: "1 g" })).toBe(false);
    expect(isEquivalentMedication(prescribed, { ...prescribed, dosageForm: "Syrup" })).toBe(false);
  });

  it("falls back to normalized generic name when concept IDs are absent", () => {
    expect(isEquivalentMedication(
      { genericName: "Amoxicillin", strength: "500 mg", dosageForm: "Capsule" },
      { genericName: " amoxicillin ", strength: "500 mg", dosageForm: "Capsule" },
    )).toBe(true);
  });
});
