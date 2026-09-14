import { describe, expect, it } from "vitest";
import { cashierShiftTotals } from "./cashier-shifts";

describe("cashier shift totals", () => {
  it("counts only confirmed cash and calculates the declared variance", () => {
    expect(cashierShiftTotals(1000, [{ amount: 500, method: "CASH", status: "CONFIRMED" }, { amount: 300, method: "MPESA", status: "CONFIRMED" }, { amount: 50, method: "CASH", status: "REVERSED" }], 1490)).toEqual({ receipts: 500, expectedCash: 1500, variance: -10 });
  });
});
