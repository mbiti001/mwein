import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), transaction: vi.fn(), replay: vi.fn(), saveReplay: vi.fn(), invoice: vi.fn(), existing: vi.fn(), shift: vi.fn(), sequence: vi.fn(), payment: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/audit", () => ({ appendAudit: mocks.audit }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
import { POST } from "./route";
const invoiceId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const input = { idempotencyKey: key, method: "MPESA", amount: 10, externalReference: "SYNTHETIC-REF" };
const actor = { id: "actor", facilityId: "facility-a" };
const body = { payment: { id: "payment", receipt: { receiptNumber: "SYNTHETIC-RECEIPT" } }, paid: 10, balance: 90 };
const fingerprint = createHash("sha256").update(JSON.stringify([invoiceId, input.method, input.amount, input.externalReference])).digest("hex");
const request = (payload: unknown = input) => POST(new Request("https://test/api/payment", { method: "POST", body: JSON.stringify(payload) }), { params: Promise.resolve({ id: invoiceId }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue(actor);
  mocks.replay.mockResolvedValue(null); mocks.existing.mockResolvedValue(null);
  mocks.invoice.mockResolvedValue({ id: invoiceId, visitId: "visit", currency: "KES", items: [{ quantity: 1, unitPrice: 100 }], payments: [], claims: [], visit: { facility: { code: "MMS" }, orders: [], encounters: [] } });
  mocks.sequence.mockResolvedValue({ nextValue: 2n });
  mocks.payment.mockResolvedValue({ ...body.payment, reference: "SYNTHETIC-RECEIPT-PAY" });
  mocks.transaction.mockImplementation(async callback => callback({
    paymentRequest: { findUnique: mocks.replay, create: mocks.saveReplay },
    invoice: { findFirst: mocks.invoice, update: mocks.update }, payment: { findFirst: mocks.existing, create: mocks.payment },
    cashierShift: { findFirst: mocks.shift }, referenceSequence: { upsert: mocks.sequence },
  }));
});
describe("payment replay protection", () => {
  it("commits a facility-scoped replay receipt with the payment", async () => {
    const response = await request();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.saveReplay).toHaveBeenCalledWith({ data: expect.objectContaining({ facilityId: actor.facilityId, invoiceId, key, fingerprint, response: expect.objectContaining({ paid: 10, balance: 90 }) }) });
    expect(mocks.invoice).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: invoiceId, visit: { facilityId: actor.facilityId } }) }));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("replays the original response without creating a second payment", async () => {
    mocks.replay.mockResolvedValue({ invoiceId, fingerprint, response: body });
    const response = await request();
    expect(response.status).toBe(200); expect(await response.json()).toEqual(body);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(mocks.replay).toHaveBeenCalledWith({ where: { facilityId_key: { facilityId: actor.facilityId, key } } });
    expect(mocks.invoice).not.toHaveBeenCalled(); expect(mocks.payment).not.toHaveBeenCalled();
  });
  it("replays a repeated non-cash reference even when the client has a new key", async () => {
    mocks.replay.mockResolvedValueOnce(null).mockResolvedValueOnce({ invoiceId, fingerprint, response: body });
    expect((await request()).status).toBe(200); expect(mocks.payment).not.toHaveBeenCalled();
  });
  it.each([{ invoiceId: "other", fingerprint }, { invoiceId, fingerprint: "changed-amount" }])("rejects key or reference reuse with different details: %j", async stored => {
    mocks.replay.mockResolvedValue({ ...stored, response: body });
    expect((await request()).status).toBe(409); expect(mocks.payment).not.toHaveBeenCalled();
  });
  it("refuses duplicate references from payments predating replay protection", async () => {
    mocks.existing.mockResolvedValue({ id: "legacy-payment" });
    expect((await request()).status).toBe(409); expect(mocks.payment).not.toHaveBeenCalled();
  });
  it("retries a serializable conflict then reads the winner's receipt", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2034" });
    mocks.replay.mockResolvedValue({ invoiceId, fingerprint, response: body });
    expect((await request()).status).toBe(200); expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
  it("bounds retries after concurrent conflicts", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2034" });
    expect((await request()).status).toBe(409); expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });
  it.each([{ ...input, idempotencyKey: undefined }, { ...input, amount: 1.001 }])("rejects unsafe payment input before writing: %j", async payload => {
    expect((await request(payload)).status).toBe(422); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("checks authorization before replay lookup", async () => {
    mocks.permission.mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    expect((await request()).status).toBe(403); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects a foreign invoice before creating a receipt", async () => {
    mocks.invoice.mockResolvedValue(null);
    expect((await request()).status).toBe(404); expect(mocks.payment).not.toHaveBeenCalled();
  });
});
