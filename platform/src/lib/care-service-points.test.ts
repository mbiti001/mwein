import { describe, expect, it } from "vitest";
import {
  careFieldKeys,
  careServiceForClinic,
  careServiceProfiles,
  referralNextStatuses,
  requiredCareFields,
  startOfDayInTimeZone,
} from "./care-service-points";

describe("care service point definitions", () => {
  it("provides each requested service once", () => {
    expect(careServiceProfiles.map((profile) => profile.code)).toEqual([
      "REFERRAL",
      "ANC",
      "MCH_PNC",
      "DIABETES",
      "DIALYSIS",
      "CANCER",
      "SICKLE_CELL",
      "WALK_IN",
    ]);
    expect(new Set(careServiceProfiles.map((profile) => profile.code)).size).toBe(careServiceProfiles.length);
  });

  it("maps legacy diabetes visits into the current diabetes workflow", () => {
    expect(careServiceForClinic("DM")?.code).toBe("DIABETES");
    expect(careServiceForClinic("Diabetes")?.code).toBe("DIABETES");
  });

  it("keeps required fields inside the allowed field set", () => {
    for (const profile of careServiceProfiles) {
      const allowed = careFieldKeys(profile.code);
      for (const required of requiredCareFields(profile.code)) expect(allowed.has(required)).toBe(true);
    }
  });

  it("gives every structured numeric field explicit capture bounds", () => {
    for (const profile of careServiceProfiles) {
      for (const field of profile.sections.flatMap((section) => section.fields)) {
        if (field.type !== "number") continue;
        expect(field.min, `${profile.code}.${field.key} minimum`).toBeTypeOf("number");
        expect(field.max, `${profile.code}.${field.key} maximum`).toBeTypeOf("number");
        expect(field.step, `${profile.code}.${field.key} step`).toBeTypeOf("number");
      }
    }
  });

  it("enforces the referral lifecycle without skipping states", () => {
    expect(referralNextStatuses("DRAFT")).toEqual(["SENT"]);
    expect(referralNextStatuses("SENT")).toEqual(["ACCEPTED"]);
    expect(referralNextStatuses("ACCEPTED")).toEqual(["ATTENDED"]);
    expect(referralNextStatuses("ATTENDED")).toEqual(["RETURNED", "CLOSED"]);
    expect(referralNextStatuses("CLOSED")).toEqual([]);
  });

  it("uses the facility day rather than the server's UTC day", () => {
    expect(
      startOfDayInTimeZone(
        new Date("2026-09-06T20:00:00.000Z"),
        "Africa/Nairobi",
      ).toISOString(),
    ).toBe("2026-09-05T21:00:00.000Z");
  });
});
