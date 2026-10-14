import { describe, expect, it } from "vitest";
import { expiryReport, type ExpiryBatch } from "./expiry-report";

const now = new Date("2026-10-15T09:00:00Z");
const batch = (id: string, days: number, quantity = 10): ExpiryBatch => ({
  id, batchNumber: `B-${id}`, expiryDate: new Date(now.getTime() + days * 86400000).toISOString(),
  quantityAvailable: quantity, catalogItem: { name: "Amoxicillin", code: "AMX" },
  locationBalances: [{ quantity: 3, store: { id: "pharmacy", name: "Pharmacy" } },
    { quantity: 7, store: { id: "main", name: "Main store" } }],
});

describe("batch expiry report", () => {
  it("separates expired stock and includes exact upcoming window endpoints", () => {
    const batches = [-1, 0, 1, 30, 31, 90, 91].map(days => batch(String(days), days));
    const ids = (window: "expired" | "30" | "90") => expiryReport(batches, { now, window }).map(row => row.id);
    expect(ids("expired")).toEqual(["-1", "0"]);
    expect(ids("30")).toEqual(["1", "30"]);
    expect(ids("90")).toEqual(["1", "30", "31", "90"]);
  });
  it("uses only the selected store's positive balance without duplicating facility stock", () => {
    const batches = [batch("a", 1)];
    expect(expiryReport(batches, { now, window: "all" })[0].quantity).toBe(10);
    expect(expiryReport(batches, { now, window: "all", storeId: "main" })[0].quantity).toBe(7);
    expect(expiryReport(batches, { now, window: "all", storeId: "unknown" })).toEqual([]);
  });
  it("excludes depleted or invalid balances and searches name, code and batch", () => {
    const invalid = { ...batch("invalid", 1), quantityAvailable: "bad" };
    expect(expiryReport([batch("zero", 1, 0), batch("negative", 1, -1), invalid], { now, window: "all" })).toEqual([]);
    for (const query of [" amoxicillin ", "amx", "B-a"]) {
      expect(expiryReport([batch("a", 2), batch("b", 1)], { now, window: "all", query }).length).toBe(query === "B-a" ? 1 : 2);
    }
  });
  it("flags invalid dates in all stock without calling them usable or upcoming", () => {
    const invalid = { ...batch("unknown", 1), expiryDate: "invalid" };
    expect(expiryReport([batch("a", 1), invalid], { now, window: "all" })[0]).toMatchObject({ id: "unknown", validExpiry: false, daysRemaining: null });
    expect(expiryReport([invalid], { now, window: "90" })).toEqual([]);
  });
});
