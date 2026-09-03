import { describe, expect, it } from "vitest";
import {
  allowedClaimStatuses,
  canTransitionClaim,
  invoiceTotals,
  paymentFitsBalance,
} from "./billing";

describe("billing safeguards", () => {
  it("calculates quantities, prior payments and balance", () => {
    expect(invoiceTotals([{ quantity: "2", unitPrice: "150" }, { quantity: 1, unitPrice: 500 }], [{ amount: "200" }])).toEqual({ total: 800, paid: 200, balance: 600 });
  });
  it("rejects zero and overpayments", () => {
    expect(paymentFitsBalance(0, 500)).toBe(false);
    expect(paymentFitsBalance(500.01, 500)).toBe(false);
    expect(paymentFitsBalance(500, 500)).toBe(true);
  });
});

describe("claim workflow safeguards", () => {
  it("allows the normal submission, adjudication and settlement path", () => {
    expect(canTransitionClaim("DRAFT", "SUBMITTED")).toBe(true);
    expect(canTransitionClaim("SUBMITTED", "APPROVED")).toBe(true);
    expect(canTransitionClaim("APPROVED", "PAID")).toBe(true);
  });

  it("blocks skipped, backward and terminal-state transitions", () => {
    expect(canTransitionClaim("DRAFT", "PAID")).toBe(false);
    expect(canTransitionClaim("APPROVED", "SUBMITTED")).toBe(false);
    expect(allowedClaimStatuses("PAID")).toEqual([]);
    expect(allowedClaimStatuses("CANCELLED")).toEqual([]);
  });

  it("allows a rejected claim to be corrected and resubmitted", () => {
    expect(allowedClaimStatuses("REJECTED")).toEqual(["SUBMITTED", "CANCELLED"]);
  });
});
