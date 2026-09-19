import { describe, expect, it } from "vitest";
import { effectiveCatalogPrice, kenyaEffectiveDate, nairobiDateInputValue, nextCatalogPrice } from "./catalog-pricing";

const item = {
  unitPrice: "500.00",
  costPrice: "300.00",
  priceVersions: [
    { id: "baseline", unitPrice: "500.00", costPrice: "300.00", effectiveFrom: "2026-01-01T00:00:00.000Z" },
    { id: "current", unitPrice: "550.00", costPrice: "320.00", effectiveFrom: "2026-09-01T00:00:00.000Z" },
    { id: "future", unitPrice: "600.00", costPrice: "340.00", effectiveFrom: "2026-10-01T00:00:00.000Z" },
  ],
};

describe("effective catalogue pricing", () => {
  it("selects the latest price effective at the charge time", () => {
    expect(effectiveCatalogPrice(item, new Date("2026-09-16T10:00:00.000Z"))).toMatchObject({
      unitPrice: "550.00",
      costPrice: "320.00",
      priceVersionId: "current",
    });
  });

  it("keeps a scheduled future price out of today's charge", () => {
    expect(effectiveCatalogPrice(item, new Date("2026-09-16T10:00:00.000Z")).unitPrice).toBe("550.00");
    expect(nextCatalogPrice(item, new Date("2026-09-16T10:00:00.000Z"))).toMatchObject({ id: "future", unitPrice: "600.00" });
  });

  it("falls back to the catalogue value for legacy or newly bootstrapped records", () => {
    expect(effectiveCatalogPrice({ unitPrice: "125.00", costPrice: null })).toMatchObject({ unitPrice: "125.00", priceVersionId: null });
  });

  it("interprets effective dates at the start of the Kenyan facility day", () => {
    expect(kenyaEffectiveDate("2026-09-17").toISOString()).toBe("2026-09-16T21:00:00.000Z");
    expect(nairobiDateInputValue(new Date("2026-09-16T22:30:00.000Z"))).toBe("2026-09-17");
  });
});
