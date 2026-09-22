import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./auth", () => ({ requirePermission: vi.fn() }));
vi.mock("./disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("./db", () => ({ db: { clinicalOrder: { findFirst: vi.fn() }, catalogItem: { findFirst: vi.fn(), findMany: vi.fn() }, store: { findFirst: vi.fn() } } }));
import { requirePermission } from "./auth";
import { recordDisclosure } from "./disclosure-audit";
import { db } from "./db";
import { GET } from "@/app/api/orders/[id]/dispense/route";
const actor = { id: "actor", sessionId: "session", facilityId: "facility" };
const request = () => GET(new Request("http://localhost/api/orders/order/dispense"), { params: Promise.resolve({ id: "order" }) });
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(actor as any);
  vi.mocked(db.clinicalOrder.findFirst).mockResolvedValue({ id: "order", prescription: { catalogItemId: "medicine", quantity: 2, dispensedQuantity: 0 } } as any);
  const medicine = { id: "medicine", code: "SYNTHETIC", name: "Synthetic medicine", inventoryBatches: [] };
  vi.mocked(db.catalogItem.findFirst).mockResolvedValue(medicine as any);
  vi.mocked(db.catalogItem.findMany).mockResolvedValue([medicine] as any);
  vi.mocked(db.store.findFirst).mockResolvedValue({ id: "store" } as any);
});
it("audits scoped dispensing details before disclosure", async () => {
  const response = await request(); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(db.clinicalOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "order", visit: { facilityId: "facility" } }) }));
  expect(recordDisclosure).toHaveBeenCalledWith(actor, "DISPENSING_DETAILS", ["order"]);
});
it("withholds details if audit persistence fails", async () => {
  vi.mocked(recordDisclosure).mockRejectedValue(new Error("audit unavailable"));
  const response = await request(); expect(response.status).toBe(500);
  expect(await response.json()).not.toHaveProperty("medicines");
});
it("does not disclose an order outside the facility", async () => {
  vi.mocked(db.clinicalOrder.findFirst).mockResolvedValue(null);
  const response = await request(); expect(response.status).toBe(404);
  expect(recordDisclosure).not.toHaveBeenCalled(); expect(db.catalogItem.findMany).not.toHaveBeenCalled();
});
