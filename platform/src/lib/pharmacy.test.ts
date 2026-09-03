import { describe, expect, it } from "vitest";
import { dispensingBalance } from "./pharmacy";

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
