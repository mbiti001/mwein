import { describe, expect, it } from "vitest";
import { clinicalClosureBlockers, closeVisitSchema } from "./visit-disposition";
const visit = { status: "AWAITING_PAYMENT", encounters: [{ status: "SIGNED" }], orders: [] };
describe("clinical closure independently of settlement", () => {
  it("does not require an invoice or payment", () => expect(clinicalClosureBlockers(visit, false)).toEqual([]));
  it("requires signed care", () => expect(clinicalClosureBlockers({ ...visit, encounters: [] }, false)).not.toEqual([]));
  it("requires explicit pending-order acknowledgement", () => {
    const pending = { ...visit, orders: [{ status: "REQUESTED" }] };
    expect(clinicalClosureBlockers(pending, false)).not.toEqual([]);
    expect(clinicalClosureBlockers(pending, true)).toEqual([]);
  });
  it("never discards work underway", () => expect(clinicalClosureBlockers({ ...visit, orders: [{ status: "IN_PROGRESS" }] }, true)).not.toEqual([]));
  it("rejects repeat closure", () => expect(clinicalClosureBlockers({ ...visit, status: "DISCHARGED" }, true)).not.toEqual([]));
  it("requires documented context for every outcome", () => {
    for (const outcome of ["RECOVERED", "OUTPATIENT", "REFERRED", "DECEASED", "AGAINST_MEDICAL_ADVICE", "OTHER"]) {
      expect(closeVisitSchema.safeParse({ outcome, details: "Counselling and follow-up plan documented" }).success).toBe(true);
      expect(closeVisitSchema.safeParse({ outcome }).success).toBe(false);
    }
  });
});
