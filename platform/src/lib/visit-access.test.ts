import { describe, expect, it } from "vitest";
import { visitAccessProfile, visitOrderTypes } from "./visit-access";

describe("minimum-necessary visit access", () => {
  it("keeps queue-only staff out of clinical and financial relationships", () => {
    const profile = visitAccessProfile(["patient.read", "visit.read", "visit.create"]);
    expect(profile).toEqual({ billing: false, clinical: false, imaging: false, laboratory: false, pharmacy: false, triage: false });
    expect(visitOrderTypes(profile)).toEqual([]);
  });

  it("limits diagnostic and pharmacy staff to their own order types", () => {
    expect(visitOrderTypes(visitAccessProfile(["visit.read", "laboratory.write"]))).toEqual(["LABORATORY"]);
    expect(visitOrderTypes(visitAccessProfile(["visit.read", "imaging.write", "pharmacy.dispense"]))).toEqual(["IMAGING", "MEDICATION"]);
  });

  it("gives clinicians the connected clinical order context", () => {
    expect(visitOrderTypes(visitAccessProfile(["visit.read", "encounter.write"]))).toEqual(["LABORATORY", "IMAGING", "MEDICATION"]);
  });
});
