import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), replay: vi.fn(), order: vi.fn(), transaction: vi.fn(), receipt: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/audit", async original => ({ ...await original<typeof import("@/lib/audit")>(), appendAudit: mocks.audit }));
import { auditValueFingerprint } from "@/lib/audit";
import { POST } from "./route";
const replayRecord = { id: "receipt", dispensedById: "user", status: "DISPENSED", prescription: { quantity: 5, dispensedQuantity: 5 }, items: [], catalogItem: { id: "medicine", name: "Synthetic medicine", code: "TEST" } };
const key = "7e9a8794-3e2d-4d46-a46d-71887b1deef0";
const original = { action: "DISPENSE", idempotencyKey: key, quantity: 5, counsellingCompleted: true };
async function dispense(changes = {}) {
  return POST(new Request("https://test/api/orders/order-id/dispense", { method: "POST", body: JSON.stringify({ ...original, ...changes }) }), { params: Promise.resolve({ id: "order-id" }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: "user", facilityId: "facility-a", sessionId: "session" });
  mocks.transaction.mockImplementation(async callback => callback({ dispensation: { findFirst: mocks.replay }, clinicalOrder: { findFirst: mocks.order }, auditEvent: { findFirst: mocks.receipt } }));
  mocks.receipt.mockImplementation(({ where }) => where.afterHash === auditValueFingerprint(original) ? { id: "audit" } : null);
});
describe("dispensing replay facility isolation", () => {
  it.each(["40001", "40P01"])("retries the full audited replay after structured SQL abort %s", async code => {
    mocks.replay.mockResolvedValue(replayRecord);
    mocks.audit.mockRejectedValueOnce({ code: "P2010", meta: { code } });
    expect((await dispense()).status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.receipt).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.order).not.toHaveBeenCalled();
  });
  it("preserves a single shared attempt budget for mixed conflicts", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" })
      .mockRejectedValueOnce({ code: "P2010", meta: { code: "40001" } })
      .mockRejectedValueOnce({ code: "P2010", meta: { code: "40P01" } });
    const response = await dispense();
    expect(response.status).toBe(409);
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not accept a different actor's winning key after retry", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2010", meta: { code: "40001" } });
    mocks.replay.mockResolvedValue({ ...replayRecord, dispensedById: "other" });
    expect((await dispense()).status).toBe(409);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("preserves the submitted fingerprint after retry", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2010", meta: { code: "40P01" } });
    mocks.replay.mockResolvedValue(replayRecord);
    expect((await dispense({ quantity: 4 })).status).toBe(409);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rechecks closed visit protection after a structured abort", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2010", meta: { code: "40001" } });
    mocks.replay.mockResolvedValue(null);
    mocks.order.mockResolvedValue({ prescription: {}, visit: { status: "DISCHARGED" } });
    expect((await dispense()).status).toBe(409);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([
    { code: "P1001" }, { code: "P2028" }, { code: "P2003" },
    { code: "P2010", meta: { code: "P0001" } }, { code: "P2010", meta: { code: "23505" } },
    { code: "P2010", message: "40001 serialization failure" }, new Error("connection lost after commit"),
  ])("does not retry unclassified or ambiguous failure %j", async error => {
    mocks.transaction.mockRejectedValue(error);
    expect((await dispense()).status).toBe("code" in error && error.code === "P2003" ? 409 : 500);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
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
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.receipt).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facilityId: "facility-a", userId: "user", entityId: "receipt" }) }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "DISPENSING_REPLAY_CONFIRMED", sessionId: "session", facilityId: "facility-a" }));
  });
  it.each([{ quantity: 4 }, { notes: "Changed request" }, { preferredBatchId: "1a9cbefa-1489-4dcb-acd1-cd3958b88492" }, { substitutionReason: "Changed reason" }, { action: "NOT_DISPENSED", notes: "No supply today" }])("rejects changed details for an existing key: %j", async change => {
    mocks.replay.mockResolvedValue(replayRecord);
    expect((await dispense(change)).status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.order).not.toHaveBeenCalled();
  });
  it("rejects another staff member's key", async () => {
    mocks.replay.mockResolvedValue({ ...replayRecord, dispensedById: "other-staff" });
    expect((await dispense()).status).toBe(409);
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("requires current dispensing authorization before any lookup", async () => {
    mocks.permission.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    expect((await dispense()).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("blocks replay disclosure when its audit fails", async () => {
    mocks.replay.mockResolvedValue(replayRecord);
    mocks.audit.mockRejectedValue(new Error("Audit unavailable"));
    expect((await dispense()).status).toBe(500);
  });
  it("does not silently confirm legacy supplies without a request receipt", async () => {
    mocks.replay.mockResolvedValue(replayRecord); mocks.receipt.mockResolvedValue(null);
    expect((await dispense()).status).toBe(409);
  });
  it.each(["P2034", "P2002"])("retries the whole transaction after %s", async code => {
    mocks.replay.mockResolvedValue(replayRecord);
    mocks.transaction.mockRejectedValueOnce({ code });
    expect((await dispense()).status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
  it("bounds transaction retries", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2034" });
    expect((await dispense()).status).toBe(409);
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });
});
