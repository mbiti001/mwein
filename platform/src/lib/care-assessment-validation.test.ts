import { describe, expect, it } from "vitest";
import { careServiceProfile } from "./care-service-points";
import { validateCareAssessment } from "./care-assessment-validation";

const anc = careServiceProfile("ANC")!;

describe("structured clinical number validation", () => {
  it("accepts a reconciled first-pregnancy history", () => {
    expect(validateCareAssessment(anc, {
      gravida: "1",
      para: "0",
      abortions: "0",
      livingChildren: "0",
    })).toEqual({ errors: [], warnings: [] });
  });

  it("rejects implausible and non-integer obstetric counts", () => {
    const aboveLimit = validateCareAssessment(anc, { gravida: "31", para: "30", abortions: "0" });
    expect(aboveLimit.errors.map((issue) => issue.message).join(" ")).toContain("Gravida cannot exceed 30");

    const fractional = validateCareAssessment(anc, { gravida: "2", para: "0.5", abortions: "0" });
    expect(fractional.errors.map((issue) => issue.message).join(" ")).toContain("Parity must be a whole number");
  });

  it("blocks outcomes that exceed the pregnancies implied by gravida", () => {
    const result = validateCareAssessment(anc, { gravida: "3", para: "2", abortions: "1" });
    expect(result.errors.map((issue) => issue.message).join(" ")).toContain("cannot exceed the 2 previous pregnancies");
  });

  it("requires unexplained previous pregnancies to be reconciled", () => {
    const unexplained = validateCareAssessment(anc, { gravida: "4", para: "1", abortions: "1" });
    expect(unexplained.errors.map((issue) => issue.message).join(" ")).toContain("accounts for 2");

    const explained = validateCareAssessment(anc, {
      gravida: "4",
      para: "1",
      abortions: "1",
      previousPregnancies: "One previous ectopic pregnancy documented in the history.",
    });
    expect(explained.errors).toEqual([]);
    expect(explained.warnings.map((issue) => issue.message).join(" ")).toContain("Verify the documented outcome explanation");
  });

  it("alerts on abnormal but possible values without discarding them", () => {
    const result = validateCareAssessment(anc, {
      gravida: "9",
      para: "5",
      abortions: "3",
      fetalHeartRate: "170",
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("High gravidity"),
      expect.stringContaining("Grand multiparity"),
      expect.stringContaining("Three or more pregnancy losses"),
      expect.stringContaining("outside 110–160 bpm"),
    ]));
  });
});
