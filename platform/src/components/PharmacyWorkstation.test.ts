import { describe, expect, it } from "vitest";
import { dispensingCompletionCopy } from "./PharmacyWorkstation";

describe("pharmacy completion guidance", () => {
  it("distinguishes full and partial supply", () => {
    expect(dispensingCompletionCopy({ isDispensing: true, loading: false, remaining: 0 })).toMatchObject({ action: "Confirm full supply", message: expect.stringContaining("completes") });
    expect(dispensingCompletionCopy({ isDispensing: true, loading: false, remaining: 4 })).toMatchObject({ action: "Confirm partial supply", message: expect.stringContaining("4 will remain") });
  });

  it("does not describe a not-supplied decision as dispensing", () => {
    expect(dispensingCompletionCopy({ isDispensing: false, loading: false, remaining: 4 })).toEqual({ action: "Record not supplied", message: "No stock will be deducted; record the reason for not supplying." });
  });
});
