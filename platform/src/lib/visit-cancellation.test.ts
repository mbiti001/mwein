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

  it.each(["ADMITTED", "REFERRED", "DISCHARGED", "COMPLETED", "CANCELLED"])("does not cancel a %s visit", status => {
    expect(visitCancellationBlockers({ ...cancellable, status }, "PATIENT_REQUEST")).not.toEqual([]);
  });

  it("protects clinical closure even when a stale status looks active", () => {
    expect(visitCancellationBlockers({ ...cancellable, clinicallyClosedAt: new Date() }, "CREATED_IN_ERROR").join(" ")).toContain("Clinical closure is already recorded");
  });

  it("protects signed clinic documents outside the encounter workflow", () => {
    expect(visitCancellationBlockers({ ...cancellable, clinicDocuments: [{ status: "SIGNED", kind: "SICK" }] }, "CREATED_IN_ERROR").join(" ")).toContain("clinical document is already signed");
    expect(visitCancellationBlockers({ ...cancellable, clinicDocuments: [{ status: "DRAFT", kind: "SICK" }] }, "CREATED_IN_ERROR")).toEqual([]);
  });

  it("retains signed administrative passes without mistaking them for delivered clinical care", () => {
    expect(visitCancellationBlockers({ ...cancellable, clinicDocuments: [{ status: "SIGNED", kind: "GATE" }] }, "PATIENT_LEFT_BEFORE_CARE")).toEqual([]);
  });

  it("does not disclose completed clinical service names in operational blockers", () => {
    const blockers = visitCancellationBlockers({ ...cancellable, orders: [{ status: "COMPLETED", displayName: "Sensitive diagnostic service" }] }, "DUPLICATE_VISIT");
    expect(blockers.join(" ")).toContain("Completed care");
    expect(blockers.join(" ")).not.toContain("Sensitive diagnostic service");
  });

  it("requires pending payments and rejected claims to be resolved explicitly", () => {
    const blockers = visitCancellationBlockers({ ...cancellable, invoice: {
      status: "OPEN", payments: [{ status: "PENDING" }], claims: [{ status: "REJECTED" }],
    } }, "PATIENT_REQUEST");
    expect(blockers).toHaveLength(2);
    expect(blockers.join(" ")).toContain("payment is pending");
    expect(blockers.join(" ")).toContain("claims workflow");
  });

  it("allows a documented cancellation after billing reversals with only unstarted work", () => {
    expect(visitCancellationBlockers({ ...cancellable,
      encounters: [{ status: "DRAFT" }],
      orders: [{ status: "DRAFT" }, { status: "REQUESTED" }, { status: "CANCELLED" }],
      invoice: { status: "OPEN", payments: [{ status: "REVERSED" }, { status: "REFUNDED" }], claims: [{ status: "DRAFT" }, { status: "CANCELLED" }] },
    }, "PATIENT_LEFT_BEFORE_CARE")).toEqual([]);
  });

  it("protects urgent care from other cover restrictions as well as SHA checks", () => {
    expect(visitCancellationBlockers({ ...cancellable, priority: "URGENT" }, "PRIVATE_COVER_NOT_AVAILABLE").join(" ")).toContain("Do not delay");
    expect(visitCancellationBlockers(cancellable, "PRIVATE_COVER_NOT_AVAILABLE")).toEqual([]);
  });

  it.each([
    { reasonCode: "UNRECOGNISED", details: "Documented explanation" },
    { reasonCode: "OTHER", details: "     " },
    { reasonCode: "OTHER", details: "Documented explanation", shaOutcome: "COVERAGE_INACTIVE" },
  ])("rejects incomplete or contradictory cancellation evidence: %j", input => {
    expect(visitCancellationSchema.safeParse(input).success).toBe(false);
  });
});
