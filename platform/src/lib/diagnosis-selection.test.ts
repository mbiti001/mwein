import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDiagnosisSelectionToken,
  verifyDiagnosisSelectionToken,
} from "./diagnosis-selection";

const originalSecret = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "diagnosis-selection-test-secret-at-least-32-characters";
});
afterEach(() => {
  process.env.AUTH_SECRET = originalSecret;
});

const selection = {
  facilityId: "facility-1",
  code: "MG30.0",
  title: "Acute headache",
  source: "Facility history" as const,
};

describe("diagnosis selection tokens", () => {
  it("accepts an unchanged, unexpired validated selection", () => {
    const token = createDiagnosisSelectionToken(selection, 1_000);
    expect(
      verifyDiagnosisSelectionToken(token, {
        facilityId: selection.facilityId,
        code: selection.code,
        title: selection.title,
      }, 2_000),
    ).toMatchObject(selection);
  });

  it("rejects edited, cross-facility and expired selections", () => {
    const token = createDiagnosisSelectionToken(selection, 1_000);
    expect(() => verifyDiagnosisSelectionToken(token, { facilityId: "facility-2", code: selection.code, title: selection.title }, 2_000)).toThrow("changed");
    expect(() => verifyDiagnosisSelectionToken(token, { facilityId: selection.facilityId, code: "FAKE", title: selection.title }, 2_000)).toThrow("changed");
    expect(() => verifyDiagnosisSelectionToken(token, { facilityId: selection.facilityId, code: selection.code, title: selection.title }, 700_001)).toThrow("expired");
  });
});
