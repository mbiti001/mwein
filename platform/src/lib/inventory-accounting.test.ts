import { describe, expect, it } from "vitest";
import {
  assertStoresNotFrozen,
  inventoryAccounts,
  inventoryPosting,
  stocktakeVariance,
  weightedAverageUnitCost,
} from "./inventory-accounting";

describe("inventory costing", () => {
  it("keeps a weighted batch cost across repeat receipts", () => {
    expect(weightedAverageUnitCost(10, 20, 5, 26)).toBe(22);
    expect(weightedAverageUnitCost(0, null, 5, 26)).toBe(26);
  });

  it("rejects zero-cost or invalid receipts", () => {
    expect(() => weightedAverageUnitCost(0, null, 5, 0)).toThrow("positive");
  });
});

describe("perpetual inventory accounting", () => {
  it("debits inventory for receipts and credits GRNI", () => {
    expect(inventoryPosting("RECEIPT", 4, 25)).toEqual({
      amount: 100,
      debit: inventoryAccounts.inventory,
      credit: inventoryAccounts.goodsReceived,
    });
  });

  it("posts dispensing to cost of goods sold", () => {
    expect(inventoryPosting("DISPENSE", -3, 12.5)).toMatchObject({
      amount: 37.5,
      debit: inventoryAccounts.costOfGoodsSold,
      credit: inventoryAccounts.inventory,
    });
  });

  it("separates stock losses from stock gains", () => {
    expect(inventoryPosting("STOCKTAKE_ADJUSTMENT", -2, 8)?.debit).toBe(inventoryAccounts.stockLoss);
    expect(inventoryPosting("STOCKTAKE_ADJUSTMENT", 2, 8)?.credit).toBe(inventoryAccounts.stockGain);
  });

  it("does not fabricate value for legacy uncosted stock", () => {
    expect(inventoryPosting("DISPENSE", -1, null)).toBeNull();
  });
});

describe("stocktake variance controls", () => {
  it("accepts exact blind counts without a reason", () => {
    expect(stocktakeVariance(10, 10)).toBe(0);
  });

  it("requires an explanation for every variance", () => {
    expect(() => stocktakeVariance(10, 9, "loss")).toThrow("Explain");
    expect(stocktakeVariance(10, 9, "Damaged pack")).toBe(-1);
  });

  it("blocks movements in a store with an active full stocktake", async () => {
    const tx = {
      stocktake: {
        findFirst: async () => ({
          stocktakeNumber: "MMS-STK-2026-000001",
          store: { name: "Main pharmacy" },
        }),
      },
    };
    await expect(assertStoresNotFrozen(tx as never, "facility-1", ["store-1"]))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("frozen") });
  });
});
