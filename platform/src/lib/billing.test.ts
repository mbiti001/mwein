import { describe, expect, it } from "vitest";
import {
  allowedClaimStatuses,
  canTransitionClaim,
  invoiceTotals,
  paymentFitsBalance,
  patientPayBalance,
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
  it("reserves patient balance while a claim is being corrected or reviewed", () => {
    expect(patientPayBalance(1000, 100, [{ amount: 600, status: "RETURNED" }])).toBe(300);
    expect(patientPayBalance(1000, 100, [{ amount: 600, status: "REJECTED" }])).toBe(900);
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
    expect(allowedClaimStatuses("PAID")).toEqual(["RECOVERED"]);
    expect(allowedClaimStatuses("CANCELLED")).toEqual([]);
  });

  it("allows a rejected claim to be corrected and resubmitted", () => {
    expect(allowedClaimStatuses("REJECTED")).toEqual(["UNDER_REVIEW", "CANCELLED"]);
  });
});
