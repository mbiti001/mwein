import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { catalogItem: { findMany: vi.fn() } } }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { GET } from "./route";
const now = new Date("2026-09-27T00:00:00Z");
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.mocked(requirePermission).mockResolvedValue({ id: "actor", sessionId: "session", facilityId: "facility-a" } as never);
});
afterEach(() => vi.useRealTimers());
it("forecasts usable stock and preserves audited private disclosure", async () => {
  vi.mocked(db.catalogItem.findMany).mockResolvedValue([{ code: "TEST", name: "Synthetic", reorderLevel: 5,
    inventoryBatches: [{ quantityAvailable: 100, expiryDate: new Date("2026-09-26") }, { quantityAvailable: 2, expiryDate: new Date("2026-10-01") }], dispensations: [],
  }] as never);
  const response = await GET(new Request("https://test/api/inventory/forecast"));
  expect(response.status).toBe(200);
  expect((await response.json()).forecasts[0]).toMatchObject({ available: 2, expiringWithin30: 2 });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(recordDisclosure).toHaveBeenCalledOnce();
  expect(db.catalogItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facilityId: "facility-a" }), select: expect.objectContaining({ inventoryBatches: { where: { active: true, expiryDate: { gt: now }, quantityAvailable: { gt: 0 } }, select: { quantityAvailable: true, expiryDate: true } } }) }));
});
it("denies unauthorized forecast access before querying stock", async () => {
  vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
  expect((await GET(new Request("https://test/api/inventory/forecast"))).status).toBe(403);
  expect(db.catalogItem.findMany).not.toHaveBeenCalled();
});
