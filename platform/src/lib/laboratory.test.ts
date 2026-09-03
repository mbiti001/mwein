import { describe, expect, it } from "vitest";
import { canonicalLaboratoryCode, laboratoryDisplayName, laboratoryFlagSummary } from "./laboratory";

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
