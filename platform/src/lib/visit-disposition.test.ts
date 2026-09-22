import { describe, expect, it } from "vitest";
import { dispositionVisitStatus, normalizedVisitOutcome, visitDispositionSchema } from "./visit-disposition";

describe("visit disposition", () => {
  it("supports every requested patient outcome", () => {
    for (const disposition of ["RECOVERED", "REFER"]) expect(visitDispositionSchema.safeParse({ disposition }).success).toBe(true);
    for (const disposition of ["DECEASED", "AGAINST_MEDICAL_ADVICE", "OTHER"])
      expect(visitDispositionSchema.safeParse({ disposition, dispositionDetails: "Documented clinical circumstances and handover" }).success).toBe(true);
  });
  it("requires context for exceptional outcomes", () => expect(visitDispositionSchema.safeParse({ disposition: "AGAINST_MEDICAL_ADVICE" }).success).toBe(false));
  it("maps legacy and routing values without losing outcome meaning", () => {
    expect(normalizedVisitOutcome("OUTPATIENT")).toBe("OUTPATIENT");
    expect(normalizedVisitOutcome("REFER")).toBe("REFERRED");
    expect(normalizedVisitOutcome("ADMIT")).toBeNull();
    expect(dispositionVisitStatus("REFER", 0)).toBe("DISCHARGED");
    expect(dispositionVisitStatus("RECOVERED", 1)).toBe("AWAITING_PHARMACY");
  });
  it("never routes exceptional outcomes to pharmacy or payment", () => {
    for (const outcome of ["DECEASED", "REFER", "AGAINST_MEDICAL_ADVICE", "OTHER"])
      for (const medicines of [0, 1, 5]) expect(dispositionVisitStatus(outcome, medicines)).toBe("DISCHARGED");
  });
});
