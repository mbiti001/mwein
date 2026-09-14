import { describe, expect, it } from "vitest";
import { stockForecast } from "./stock-forecast";

describe("stock forecast", () => {
  it("calculates days of stock and a lead-time reorder suggestion", () => {
    expect(stockForecast({ code: "A", name: "A", available: 10, reorderLevel: 5, consumed: 90, expiringWithin30: 0 }, 90, 30)).toMatchObject({ dailyUse: 1, daysOfStock: 10, suggestedOrder: 25, status: "CRITICAL" });
  });
  it("marks available stock without use as slow moving", () => {
    expect(stockForecast({ code: "B", name: "B", available: 40, reorderLevel: 5, consumed: 0, expiringWithin30: 0 }).status).toBe("SLOW_MOVING");
  });
});
