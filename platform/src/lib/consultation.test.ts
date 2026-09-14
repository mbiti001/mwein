import { describe, expect, it } from "vitest";
import { consultationNotesSchema } from "./consultation";

const baseNotes = {
  chiefComplaint: "Cough",
  historyPresentingIllness: "Cough is worse at night without haemoptysis.",
  generalExamination: "General appearance: Well appearing",
  disposition: "OUTPATIENT" as const,
};

describe("consultation note validation", () => {
  it("accepts multiple complaints with explicit duration units", () => {
    const result = consultationNotesSchema.parse({
      ...baseNotes,
      complaints: [
        { complaint: "Cough", durationValue: 3, durationUnit: "DAYS" },
        { complaint: "Headache", durationValue: 6, durationUnit: "HOURS" },
      ],
    });

    expect(result.complaints).toHaveLength(2);
    expect(result.complaints[1]).toMatchObject({
      complaint: "Headache",
      durationUnit: "HOURS",
    });
  });

  it("requires a unit whenever a complaint duration is recorded", () => {
    const result = consultationNotesSchema.safeParse({
      ...baseNotes,
      complaints: [{ complaint: "Cough", durationValue: 3 }],
    });

    expect(result.success).toBe(false);
  });

  it("continues to accept legacy notes without a complaints array", () => {
    const result = consultationNotesSchema.parse({
      ...baseNotes,
      symptomDuration: "3 days",
    });

    expect(result.complaints).toEqual([]);
  });
});
