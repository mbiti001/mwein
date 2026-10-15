import { describe, expect, it } from "vitest";
import { consultationNotesSchema, prescriptionSchema } from "./consultation";

const baseNotes = {
  chiefComplaint: "Cough",
  historyPresentingIllness: "Cough is worse at night without haemoptysis.",
  generalExamination: "General appearance: Well appearing",
  disposition: "OUTPATIENT" as const,
};

describe("consultation note validation", () => {
  it("accepts multiple complaints with explicit duration units", () => {
    const result = consultationNotesSchema.parse({
      ...baseNotes,
      complaints: [
        { complaint: "Cough", durationValue: 3, durationUnit: "DAYS" },
        { complaint: "Headache", durationValue: 6, durationUnit: "HOURS" },
      ],
    });

    expect(result.complaints).toHaveLength(2);
    expect(result.complaints[1]).toMatchObject({
      complaint: "Headache",
      durationUnit: "HOURS",
    });
  });

  it("requires a unit whenever a complaint duration is recorded", () => {
    const result = consultationNotesSchema.safeParse({
      ...baseNotes,
      complaints: [{ complaint: "Cough", durationValue: 3 }],
    });

    expect(result.success).toBe(false);
  });

  it("continues to accept legacy notes without a complaints array", () => {
    const result = consultationNotesSchema.parse({
      ...baseNotes,
      symptomDuration: "3 days",
    });

    expect(result.complaints).toEqual([]);
  });
});

const rxLine = { medicineCode: "SYNTH-A", indication: "Synthetic indication", dose: "1 tablet", route: "Oral", frequency: "Once daily", duration: "2 days", startDate: "2026-10-16", quantity: 2, instructions: "Synthetic instructions" };
const rxList = { idempotencyKey: "00000000-0000-4000-8000-000000000001", prescriptions: [rxLine] };
describe("prescription list boundaries", () => {
  it("accepts separate medicines without deriving dose defaults", () => {
    const parsed=prescriptionSchema.parse({...rxList,prescriptions:[rxLine,{...rxLine,medicineCode:"SYNTH-B"}]});
    expect(parsed.prescriptions).toHaveLength(2); expect(parsed.prescriptions[0].doseQuantity).toBeUndefined();
  });
  it("rejects duplicate codes regardless of case", () => {
    expect(prescriptionSchema.safeParse({...rxList,prescriptions:[rxLine,{...rxLine,medicineCode:"synth-a"}]}).success).toBe(false);
  });
  it("requires a saved revision even for legacy draft edits", () => {
    const item={...rxLine,existingOrderId:rxList.idempotencyKey};
    expect(prescriptionSchema.safeParse({...rxList,prescriptions:[item]}).success).toBe(false);
    expect(prescriptionSchema.safeParse({...rxList,prescriptions:[{...item,expectedPrescriptionKey:null}]}).success).toBe(true);
  });
  it("does not apply a single duplicate exception to a multi-medicine list", () => {
    expect(prescriptionSchema.safeParse({...rxList,duplicateAction:"KEEP_BOTH",duplicateReason:"Reviewed clinically",prescriptions:[rxLine,{...rxLine,medicineCode:"SYNTH-B"}]}).success).toBe(false);
  });
});
