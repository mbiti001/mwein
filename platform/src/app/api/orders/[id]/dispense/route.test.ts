import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), replay: vi.fn(), order: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
import { POST } from "./route";
const replayRecord = { status: "DISPENSED", prescription: { quantity: 5, dispensedQuantity: 5 }, items: [], catalogItem: { id: "medicine", name: "Synthetic medicine", code: "TEST" } };
const key = "7e9a8794-3e2d-4d46-a46d-71887b1deef0";
async function dispense() {
  return POST(new Request("https://test/api/orders/order-id/dispense", { method: "POST", body: JSON.stringify({ action: "DISPENSE", idempotencyKey: key, quantity: 5, counsellingCompleted: true }) }), { params: Promise.resolve({ id: "order-id" }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: "user", facilityId: "facility-a", sessionId: "session" });
  mocks.transaction.mockImplementation(async callback => callback({ dispensation: { findFirst: mocks.replay }, clinicalOrder: { findFirst: mocks.order } }));
});
describe("dispensing replay facility isolation", () => {
  it("does not disclose a foreign facility replay even with its order ID and replay key", async () => {
    // Synthetic stored replay belongs to facility-b. Simulate the DB relation filter.
    mocks.replay.mockImplementation(({ where }) => where.prescription.order?.visit.facilityId === "facility-a" ? null : replayRecord);
    mocks.order.mockResolvedValue(null);
    const response = await dispense();
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("replayed");
    expect(mocks.order).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ visit: { facilityId: "facility-a" } }) }));
  });
  it("preserves idempotent replay for the original facility without dispensing again", async () => {
    mocks.replay.mockResolvedValue(replayRecord);
    const response = await dispense();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: true, remainingQuantity: 0 });
    expect(mocks.replay).toHaveBeenCalledWith(expect.objectContaining({ where: { idempotencyKey: key, prescription: { orderId: "order-id", order: { visit: { facilityId: "facility-a" } } } } }));
    expect(mocks.order).not.toHaveBeenCalled();
  });
});
