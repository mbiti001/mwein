import { describe, expect, it } from "vitest";
import {
  kenyaMedicineReferences,
  kenyaReferenceDraft,
  KEML_SOURCE,
} from "./kenya-medicines";
describe("Kenya medicine naming references", () => {
  it("prepares attributed inactive entries without inventing product approval, prices or dosing", () => {
    for (const item of kenyaMedicineReferences) {
      const draft = kenyaReferenceDraft(item);
      expect(draft.active).toBe(false);
      expect(draft.description).toContain(KEML_SOURCE);
      expect(draft.description).toContain("section " + item.section);
      expect(draft).not.toHaveProperty("dose");
      expect(draft).not.toHaveProperty("unitPrice");
      expect(draft).not.toHaveProperty("unitOfMeasure");
      expect(draft.code.length).toBeLessThanOrEqual(40);
    }
    expect(new Set(kenyaMedicineReferences.map((item) => item.id)).size).toBe(
      kenyaMedicineReferences.length,
    );
  });
  it("preserves combination components, dosage forms and source restrictions", () => {
    expect(
      kenyaMedicineReferences.find(
        (item) => item.id === "AMOX-CLAV-875-125-TAB",
      ),
    ).toMatchObject({
      genericName: "Amoxicillin + clavulanic acid",
      strength: "875 mg + 125 mg",
      level: 4,
      page: 20,
    });
    expect(
      kenyaMedicineReferences.find((item) => item.id === "METFORMIN-500-TAB")
        ?.note,
    ).toContain("footnote 400");
    expect(
      kenyaMedicineReferences
        .filter((item) => item.genericName === "Paracetamol")
        .map((item) => item.dosageForm),
    ).toEqual(["Tablet (scored)", "Oral liquid"]);
  });
});
