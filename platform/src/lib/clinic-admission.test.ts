import { describe, expect, it } from "vitest";
import { assessAncAdmission } from "./clinic-admission";

const positive = {
  result: "POSITIVE" as const,
  method: "FACILITY_LAB" as const,
  testedAt: "2026-09-01",
  evidenceReference: "UPT-2026-001",
  consentConfirmed: true,
};

describe("ANC admission safety", () => {
  it("admits a routine ANC client with consented positive evidence", () => {
    expect(
      assessAncAdmission(
        { sexAtBirth: "FEMALE", dateOfBirth: "2000-01-01" },
        positive,
        new Date("2026-09-14T12:00:00Z"),
      ),
    ).toEqual({ admitted: true, safeguardingReviewRequired: false, age: 26 });
  });

  it("does not admit an unconfirmed or negative routine ANC client", () => {
    const decision = assessAncAdmission(
      { sexAtBirth: "FEMALE", estimatedAgeYears: 22 },
      { ...positive, result: "NEGATIVE" },
      new Date("2026-09-14T12:00:00Z"),
    );
    expect(decision.admitted).toBe(false);
  });

  it("protects access for a pregnant child while requiring clinician safeguarding review", () => {
    expect(
      assessAncAdmission(
        { sexAtBirth: "FEMALE", estimatedAgeYears: 14 },
        positive,
        new Date("2026-09-14T12:00:00Z"),
      ),
    ).toEqual({ admitted: true, safeguardingReviewRequired: true, age: 14 });
  });

  it("requires safeguarding review when age cannot be established", () => {
    expect(
      assessAncAdmission(
        { sexAtBirth: "UNKNOWN" },
        positive,
        new Date("2026-09-14T12:00:00Z"),
      ),
    ).toEqual({ admitted: true, safeguardingReviewRequired: true, age: null });
  });

  it("rejects future-dated evidence", () => {
    const decision = assessAncAdmission(
      { sexAtBirth: "FEMALE", estimatedAgeYears: 22 },
      { ...positive, testedAt: "2026-09-15" },
      new Date("2026-09-14T12:00:00Z"),
    );
    expect(decision.admitted).toBe(false);
  });
});
