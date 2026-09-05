import { describe, expect, it } from "vitest";
import { canTransitionPurchaseOrder, countDisposition, isIndependentChecker } from "./supply-controls";

describe("supply controls", () => {
  it("permits only controlled purchase-order transitions", () => {
    expect(canTransitionPurchaseOrder("DRAFT", "SUBMITTED")).toBe(true);
    expect(canTransitionPurchaseOrder("SUBMITTED", "APPROVED")).toBe(true);
    expect(canTransitionPurchaseOrder("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionPurchaseOrder("RECEIVED", "APPROVED")).toBe(false);
  });
  it("requires an independent checker", () => {
    expect(isIndependentChecker("checker", "maker", "submitter")).toBe(true);
    expect(isIndependentChecker("maker", "maker", "submitter")).toBe(false);
    expect(isIndependentChecker("submitter", "maker", "submitter")).toBe(false);
  });
  it("posts exact counts and holds variances", () => {
    expect(countDisposition(0)).toBe("POSTED");
    expect(countDisposition(-1)).toBe("PENDING");
    expect(countDisposition(4)).toBe("PENDING");
  });
});
