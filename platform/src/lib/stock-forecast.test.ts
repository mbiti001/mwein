import { describe, expect, it } from "vitest";
import { stockForecast, usableBatchStock } from "./stock-forecast";

describe("stock forecast", () => {
  it("calculates days of stock and a lead-time reorder suggestion", () => {
    expect(stockForecast({ code: "A", name: "A", available: 10, reorderLevel: 5, consumed: 90, expiringWithin30: 0 }, 90, 30)).toMatchObject({ dailyUse: 1, daysOfStock: 10, suggestedOrder: 25, status: "CRITICAL" });
  });
  it("marks available stock without use as slow moving", () => {
    expect(stockForecast({ code: "B", name: "B", available: 40, reorderLevel: 5, consumed: 0, expiringWithin30: 0 }).status).toBe("SLOW_MOVING");
  });
});


describe("usable batch stock", () => {
  const now = new Date("2026-09-27T00:00:00Z");
  it("excludes expired and exactly-expiring batches from availability and upcoming expiries", () => {
    expect(usableBatchStock([
      { quantityAvailable: 100, expiryDate: "2026-09-26T23:59:59Z" },
      { quantityAvailable: 50, expiryDate: now },
      { quantityAvailable: 3, expiryDate: "2026-10-01T00:00:00Z" },
    ], now)).toEqual({ available: 3, expiringWithin30: 3, expiringWithin90: 3 });
  });
  it("includes the 30/90-day endpoints, without counting longer-lived stock as expiring", () => {
    const batch = (days: number, quantityAvailable: number) => ({ quantityAvailable, expiryDate: new Date(now.getTime() + days * 86400000) });
    expect(usableBatchStock([batch(30, 2), batch(31, 3), batch(90, 5), batch(91, 7)], now)).toEqual({ available: 17, expiringWithin30: 2, expiringWithin90: 10 });
  });
  it("ignores depleted, invalid and negative quantities", () => {
    expect(usableBatchStock([
      { quantityAvailable: 0, expiryDate: "2026-10-01" },
      { quantityAvailable: -5, expiryDate: "2026-10-01" },
      { quantityAvailable: "invalid", expiryDate: "2026-10-01" },
      { quantityAvailable: 10, expiryDate: "invalid" },
    ], now)).toEqual({ available: 0, expiringWithin30: 0, expiringWithin90: 0 });
  });
});
