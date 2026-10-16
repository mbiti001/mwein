import { describe, expect, it } from "vitest";
import { demographicCorrectionValue } from "./demographic-correction-input";

describe("controlled demographic correction input", () => {
  it.each(["", " ", "\t", "abc", "NaN", "Infinity", "-Infinity", "1.5", "-1", "131", "null", "undefined"])("rejects invalid age %j before serialization", raw => {
    expect(() => demographicCorrectionValue("estimatedAgeYears", raw)).toThrow("whole years");
  });
  it.each([["0", 0], [" 0 ", 0], ["30", 30], ["130", 130]])("preserves deliberate age %s", (raw, age) => {
    const result = demographicCorrectionValue("estimatedAgeYears", String(raw));
    expect(result).toBe(age);
    expect(JSON.parse(JSON.stringify({ estimatedAgeYears: result }))).toEqual({ estimatedAgeYears: age });
  });
  it("requires explicit NULL for clearing age", () => {
    expect(demographicCorrectionValue("estimatedAgeYears", "NULL")).toBeNull();
    expect(demographicCorrectionValue("estimatedAgeYears", "0")).toBe(0);
  });
  it("leaves nonnumeric fields and their explicit clear to existing API validation", () => {
    expect(demographicCorrectionValue("givenName", "Amina")).toBe("Amina");
    expect(demographicCorrectionValue("dateOfBirth", "1990-01-01")).toBe("1990-01-01");
    expect(demographicCorrectionValue("middleName", "NULL")).toBeNull();
  });
});
