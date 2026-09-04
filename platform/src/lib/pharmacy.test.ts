import { describe, expect, it } from "vitest";
import { dispensingBalance, planFefoAllocation } from "./pharmacy";

describe("partial dispensing", () => {
  it("keeps the outstanding balance active", () => {
    expect(dispensingBalance(20, 0, 10)).toEqual({
      cumulativeDispensed: 10,
      remainingAfter: 10,
      complete: false,
    });
  });

  it("completes a prescription over multiple supplies", () => {
    expect(dispensingBalance(20, 10, 10)).toEqual({
      cumulativeDispensed: 20,
      remainingAfter: 0,
      complete: true,
    });
  });

  it("rejects supply above the outstanding quantity", () => {
    expect(() => dispensingBalance(20, 10, 11)).toThrow(
      "outstanding quantity of 10",
    );
  });
});

describe("FEFO batch allocation", () => {
  const batches = [
    { id: "early", batchNumber: "B-001", expiryDate: "2026-10-01", quantityAvailable: 4 },
    { id: "later", batchNumber: "B-002", expiryDate: "2027-01-01", quantityAvailable: 10 },
  ];

  it("uses the earliest-expiring stock first and spans batches when needed", () => {
    expect(planFefoAllocation(batches, 6).map(({ id, quantity }) => ({ id, quantity }))).toEqual([
      { id: "early", quantity: 4 },
      { id: "later", quantity: 2 },
    ]);
  });

  it("rejects a quantity above available stock", () => {
    expect(() => planFefoAllocation(batches, 15)).toThrow("Available: 14");
  });
});
