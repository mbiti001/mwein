import { describe, expect, it } from "vitest";
import { visitCancellationBlockers, visitCancellationSchema } from "./visit-cancellation";

const cancellable = {
  status: "AWAITING_TRIAGE",
  clinic: "General outpatient",
  visitType: "WALK_IN",
  priority: "ROUTINE",
  encounters: [],
  orders: [],
  invoice: { status: "OPEN", payments: [], claims: [] },
};

describe("visit cancellation", () => {
  it("accepts a documented operational cancellation", () => {
    expect(visitCancellationSchema.parse({ reasonCode: "PATIENT_REQUEST", details: "Patient chose to return tomorrow" }).reasonCode).toBe("PATIENT_REQUEST");
    expect(visitCancellationBlockers(cancellable, "PATIENT_REQUEST")).toEqual([]);
  });

  it("requires the SHA outcome and verification reference", () => {
    const result = visitCancellationSchema.safeParse({ reasonCode: "SHA_BENEFIT_OR_ELIGIBILITY", details: "Benefit was not available" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path[0])).toEqual(expect.arrayContaining(["shaOutcome", "shaEligibilityReference"]));
  });

  it("prevents benefit checks from interrupting urgent or emergency care", () => {
    expect(visitCancellationBlockers({ ...cancellable, priority: "URGENT" }, "SHA_BENEFIT_OR_ELIGIBILITY").join(" ")).toContain("Do not delay");
    expect(visitCancellationBlockers({ ...cancellable, clinic: "Emergency" }, "SHA_BENEFIT_OR_ELIGIBILITY").join(" ")).toContain("stabilisation");
  });

  it("protects final clinical work, delivered services, payments and external claims", () => {
    const blockers = visitCancellationBlockers({
      ...cancellable,
      encounters: [{ status: "SIGNED" }],
      orders: [{ status: "COMPLETED", displayName: "Full blood count" }],
      invoice: { status: "PART_PAID", payments: [{ status: "CONFIRMED" }], claims: [{ status: "SUBMITTED" }] },
    }, "PATIENT_REQUEST");
    expect(blockers).toHaveLength(4);
  });
});
