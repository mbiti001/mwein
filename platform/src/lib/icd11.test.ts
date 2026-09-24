import { describe, expect, it } from "vitest";
import { cleanWhoTitle, icd11Release, normalizeWhoIcdUri } from "./icd11";

describe("ICD-11 identifiers", () => {
  it("retains WHO's canonical http identifier while accepting https input", () => {
    expect(normalizeWhoIcdUri("https://id.who.int/icd/entity/257068234", "foundation"))
      .toBe("http://id.who.int/icd/entity/257068234");
    expect(normalizeWhoIcdUri("http://id.who.int/icd/release/11/2026-01/mms/257068234", "linearization"))
      .toBe("http://id.who.int/icd/release/11/2026-01/mms/257068234");
  });

  it("rejects non-WHO and malformed release identifiers", () => {
    expect(() => normalizeWhoIcdUri("https://example.com/icd/entity/1", "foundation")).toThrow("Invalid WHO");
    expect(() => icd11Release("latest")).toThrow("YYYY-MM");
  });

  it("removes WHO search highlighting without leaving encoded punctuation", () => {
    expect(cleanWhoTitle("<em>Acute</em> headache &amp; pain")).toBe("Acute headache & pain");
  });
});
