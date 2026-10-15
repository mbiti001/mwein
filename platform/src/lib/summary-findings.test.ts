import { describe, expect, it } from "vitest";
import { hasRecordedFindings, recordedFindings, recordedText } from "./summary-findings";

describe("recorded summary findings", () => {
  it("omits untouched examination and review defaults, including empty values", () => {
    const result = recordedFindings("General appearance: Not assessed\nLymph nodes: Not examined\nPallor assessment site: Not recorded\nBowel sounds: Not auscultated\nOedema distribution: Not applicable\nFetal movement: Not applicable / not asked\nCough: Not asked\nSkin:  ");
    expect(hasRecordedFindings(result)).toBe(false);
    expect(recordedFindings(null)).toEqual({ findings: [], notes: [] });
    expect(recordedText(" \r\n ")).toBe("");
  });

  it("retains normal, abnormal and negative findings in their recorded order", () => {
    const text = "Pallor: Absent\r\nAdded sounds: None\r\nJVP: Not elevated\r\nMurmur: No murmur heard\r\nMuscle tone: Normal\r\nLowest MRC muscle power: 0/5\r\nPeripheral perfusion: Warm; capillary refill ≤2 s\r\nSkin: Rash";
    expect(recordedFindings(text).findings.map(item => item.value)).toEqual([
      "Absent", "None", "Not elevated", "No murmur heard", "Normal", "0/5", "Warm; capillary refill ≤2 s", "Rash",
    ]);
    expect(text).toContain("Pallor: Absent");
  });

  it("preserves explained limitations and multiline clinician notes verbatim", () => {
    const result = recordedFindings("Gait: Not examined due to pain\nAdditional findings: Unable to complete assessment.\nReason: patient declined.\nRepeat assessment planned at 14:30.");
    expect(result.findings).toEqual([{ label: "Gait", value: "Not examined due to pain" }]);
    expect(result.notes).toEqual([{ label: "Additional findings", value: "Unable to complete assessment.\nReason: patient declined.\nRepeat assessment planned at 14:30." }]);
    expect(recordedFindings("Alert and comfortable.\nChest examination documented.").notes).toHaveLength(2);
  });

  it("matches only complete placeholder values and keeps unfamiliar clinical text", () => {
    expect(recordedFindings("Hydration:  NOT   ASSESSED \nNew finding: Recorded by external clinician\nCough: Denied").findings).toEqual([
      { label: "New finding", value: "Recorded by external clinician" }, { label: "Cough", value: "Denied" },
    ]);
    expect(recordedText("Not assessed previously; assessed today.")).toBe("Not assessed previously; assessed today.");
  });
});
