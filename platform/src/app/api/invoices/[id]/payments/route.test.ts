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
  it.each(["40001", "40P01"])("restarts the entire payment after structured SQL abort %s", async code => {
    mocks.audit.mockRejectedValueOnce({ code: "P2010", meta: { code } });
    const response = await request();
    expect(response.status).toBe(201);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.invoice).toHaveBeenCalledTimes(2);
    expect(mocks.sequence).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.saveReplay).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Idempotency-Replayed")).toBe("false");
  });
  it("shares the three-attempt budget across structured conflicts and unique-key reconciliation", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2010", meta: { code: "40001" } })
      .mockRejectedValueOnce({ code: "P2002" }).mockRejectedValueOnce({ code: "P2010", meta: { code: "40P01" } });
    const response = await request();
    expect(response.status).toBe(409);
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.payment).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("reconciles a unique-key winner through the original replay contract", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" });
    mocks.replay.mockResolvedValue({ invoiceId, fingerprint, response: body });
    expect((await request()).status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.payment).not.toHaveBeenCalled();
  });
  it("rejects changed winner details after an aborted attempt", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2010", meta: { code: "40001" } });
    mocks.replay.mockResolvedValue({ invoiceId, fingerprint: "different", response: body });
    expect((await request()).status).toBe(409);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.payment).not.toHaveBeenCalled();
  });
  it("rereads invoice facility visibility after an abort", async () => {
    mocks.audit.mockRejectedValueOnce({ code: "P2010", meta: { code: "40001" } });
    const invoice = await mocks.invoice(); mocks.invoice.mockClear();
    mocks.invoice.mockResolvedValueOnce(invoice).mockResolvedValueOnce(null);
    expect((await request()).status).toBe(404);
    expect(mocks.invoice).toHaveBeenCalledTimes(2);
    expect(mocks.saveReplay).not.toHaveBeenCalled();
  });
  it("rechecks the remaining patient balance after an aborted payment", async () => {
    mocks.audit.mockRejectedValueOnce({ code: "P2010", meta: { code: "40001" } });
    const invoice = await mocks.invoice(); mocks.invoice.mockClear();
    mocks.invoice.mockResolvedValueOnce(invoice).mockResolvedValueOnce({ ...invoice, payments: [{ amount: 100 }] });
    expect((await request()).status).toBe(422);
    expect(mocks.payment).toHaveBeenCalledTimes(1);
    expect(mocks.saveReplay).not.toHaveBeenCalled();
  });
  it("rechecks the cashier's open shift after an abort", async () => {
    mocks.shift.mockResolvedValueOnce({ id: "shift" }).mockResolvedValueOnce(null);
    mocks.audit.mockRejectedValueOnce({ code: "P2010", meta: { code: "40P01" } });
    expect((await request({ ...input, method: "CASH" })).status).toBe(409);
    expect(mocks.shift).toHaveBeenCalledTimes(2);
    expect(mocks.saveReplay).not.toHaveBeenCalled();
  });
  it.each([
    { code: "P1001" }, { code: "P2028" }, { code: "P2003" },
    { code: "P2010", meta: { code: "P0001" } }, { code: "P2010", meta: { code: "23505" } },
    { code: "P2010", message: "40001 serialization failure" }, new Error("connection lost after commit"),
  ])("does not retry unclassified or ambiguous failure %j", async error => {
    mocks.transaction.mockRejectedValue(error);
    expect((await request()).status).toBe("code" in error && error.code === "P2003" ? 409 : 500);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
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
