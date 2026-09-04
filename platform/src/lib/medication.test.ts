import { describe, expect, it } from "vitest";
import { calculateDispenseQuantity, normalizeMedicationConcept, periodsOverlap, sameVisitMedicationKey, treatmentStopDate } from "./medication";

describe("medication safety helpers", () => {
  it("normalizes brands and spelling-safe concept identifiers", () => {
    expect(normalizeMedicationConcept(" Amoxicillin / Clavulanate ")).toBe("amoxicillin-clavulanate");
  });

  it("uses one normalized medicine slot per visit", () => {
    expect(sameVisitMedicationKey("visit-123", normalizeMedicationConcept("Paracetamol"))).toBe("visit-123:paracetamol");
    expect(sameVisitMedicationKey("visit-123", normalizeMedicationConcept("PARACETAMOL"))).toBe("visit-123:paracetamol");
  });

  it("calculates the course quantity without floating-point drift", () => {
    expect(calculateDispenseQuantity(1, 3, 5)).toBe(15);
    expect(calculateDispenseQuantity(0.5, 2, 7)).toBe(7);
    expect(calculateDispenseQuantity(0, 2, 7)).toBe(0);
  });

  it("derives an inclusive stop date from a structured duration", () => {
    expect(treatmentStopDate(new Date("2026-09-04"), "5 days")?.toISOString().slice(0, 10)).toBe("2026-09-08");
  });

  it("detects overlapping active treatment periods", () => {
    expect(periodsOverlap(new Date("2026-09-01"), new Date("2026-09-10"), new Date("2026-09-10"), new Date("2026-09-12"))).toBe(true);
    expect(periodsOverlap(new Date("2026-09-01"), new Date("2026-09-09"), new Date("2026-09-10"), null)).toBe(false);
  });
});
