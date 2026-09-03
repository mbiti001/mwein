import { describe, expect, it } from "vitest";
import { canonicalLaboratoryCode, laboratoryDisplayName, laboratoryFlagSummary, normalizeHaemoglobinUnit, ZYBIO_Z3_COMPONENTS } from "./laboratory";

describe("laboratory terminology", () => {
  it.each(["FBC", "CBC", "full blood count", "hemogram", "haemogram", "full hemogram", "full haemogram"])("maps %s to the complete FBC panel", value => {
    expect(canonicalLaboratoryCode(value)).toBe("FBC");
  });

  it("makes the synonyms visible on the report", () => {
    expect(laboratoryDisplayName("CBC")).toContain("Full haemogram (hemogram)");
  });

  it("summarises flags without generating a diagnosis", () => {
    expect(laboratoryFlagSummary([{ analyte: "Haemoglobin", flag: "LOW" }])).toContain("Haemoglobin low");
  });
});

describe("Zybio Z3 profile", () => {
  it("contains the manufacturer's 21 three-part parameters", () => {
    expect(ZYBIO_Z3_COMPONENTS).toHaveLength(21);
    expect(ZYBIO_Z3_COMPONENTS.map((item) => item[1])).toContain("FBC-MID-ABS");
    expect(ZYBIO_Z3_COMPONENTS.map((item) => item[1])).not.toContain("FBC-EOS-ABS");
  });

  it("converts analyser haemoglobin values from g/L to g/dL", () => {
    expect(normalizeHaemoglobinUnit(140, "g/L")).toEqual({ value: 14, unit: "g/dL", originalValue: 140, originalUnit: "g/L" });
  });
});
