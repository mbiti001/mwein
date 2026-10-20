import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), transaction: vi.fn(), order: vi.fn(), orderUpdate: vi.fn(),
  laboratoryUpdate: vi.fn(), laboratoryResult: vi.fn(), imagingResult: vi.fn(),
  catalog: vi.fn(), sequence: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/audit", () => ({ appendAudit: mocks.audit }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
import { POST as specimen } from "./[id]/specimen/route";
import { POST as laboratory } from "./[id]/laboratory-result/route";
import { POST as imaging } from "./[id]/imaging-result/route";

const orderId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id: orderId }) };
const cases = [
  { label: "specimen collection", handler: specimen, payload: { action: "COLLECT", collectedAt: "2026-10-20T10:00:00Z" } },
  { label: "laboratory result", handler: laboratory, payload: { action: "SAVE_DRAFT", items: [{ analyte: "Synthetic analyte", value: "10" }] } },
  { label: "imaging report", handler: imaging, payload: { action: "SAVE_DRAFT", findings: "Synthetic findings", conclusion: "Synthetic conclusion" } },
];
const activeOrder = () => ({
  id: orderId, visitId: "visit", status: "REQUESTED", displayName: "Synthetic test",
  laboratory: { id: "lab", testCode: "TEST", specimenStatus: "ACCEPTED" },
  imaging: { id: "image" },
  visit: { status: "AWAITING_RESULTS", clinicallyClosedAt: null, facility: { code: "MMS" },
    patient: { dateOfBirth: null, estimatedAgeYears: 30, sexAtBirth: "MALE" } },
});
const transaction = {
  clinicalOrder: { findFirst: mocks.order, update: mocks.orderUpdate },
  laboratoryOrder: { update: mocks.laboratoryUpdate }, laboratoryResult: { upsert: mocks.laboratoryResult },
  imagingResult: { upsert: mocks.imagingResult }, catalogItem: { findFirst: mocks.catalog },
  referenceSequence: { upsert: mocks.sequence },
};
const request = (entry: typeof cases[number]) => entry.handler(new Request("https://test/api/orders/order", { method: "POST", body: JSON.stringify(entry.payload) }), context);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: "actor", facilityId: "facility-a" });
  mocks.order.mockResolvedValue(activeOrder());
  mocks.catalog.mockResolvedValue(null);
  mocks.sequence.mockResolvedValue({ nextValue: 2n });
  mocks.laboratoryUpdate.mockResolvedValue({ id: "lab", accessionNumber: "SYNTHETIC" });
  mocks.laboratoryResult.mockResolvedValue({ id: "result" });
  mocks.imagingResult.mockResolvedValue({ id: "report", status: "DRAFT", conclusion: "Synthetic conclusion" });
  mocks.transaction.mockImplementation(async callback => callback(transaction));
});

describe("diagnostic mutations cannot revive cancelled visits", () => {
  it.each(cases)("checks and updates $label in a serializable transaction", async entry => {
    expect((await request(entry)).status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.order).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: orderId, visit: { facilityId: "facility-a" } }) }));
    expect(mocks.orderUpdate).toHaveBeenCalled();
  });

  it.each(cases)("rejects stale $label when the parent visit is cancelled even if the order looks active", async entry => {
    const order = activeOrder();
    mocks.order.mockResolvedValue({ ...order, visit: { ...order.visit, status: "CANCELLED" } });
    expect((await request(entry)).status).toBe(409);
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.laboratoryUpdate).not.toHaveBeenCalled();
    expect(mocks.laboratoryResult).not.toHaveBeenCalled();
    expect(mocks.imagingResult).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each(cases)("rejects stale $label on a cancelled order", async entry => {
    mocks.order.mockResolvedValue({ ...activeOrder(), status: "CANCELLED" });
    expect((await request(entry)).status).toBe(409);
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
  });

  it.each(cases)("does not report $label as saved when a concurrent change aborts the transaction", async entry => {
    mocks.transaction.mockImplementation(async callback => {
      await callback(transaction);
      // PostgreSQL rejects the commit if cancellation invalidated this snapshot.
      throw Object.assign(new Error("Concurrent transaction conflict"), { code: "P2034" });
    });
    const response = await request(entry);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.reason).toContain("No partial change was committed");
    expect(body).not.toHaveProperty("report");
    expect(body).not.toHaveProperty("laboratoryResult");
  });
});
