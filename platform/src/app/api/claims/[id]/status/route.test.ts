import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), transaction: vi.fn(), claim: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/audit", () => ({ appendAudit: mocks.audit }));
// Claim reads must use the transaction client, never a pre-transaction snapshot.
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
import { POST } from "./route";

const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const activeClaim = () => ({
  id, payer: "PRIVATE_INSURER", status: "DRAFT", notes: "Original record", submittedAt: null,
  invoice: { status: "OPEN", visit: { status: "AWAITING_PAYMENT" } },
});
const transaction = { claim: { findFirst: mocks.claim, update: mocks.update } };
const request = (status = "SUBMITTED") => POST(new Request("https://test/api/claims/claim/status", { method: "POST", body: JSON.stringify({ status, notes: "Documented claim action" }) }), context);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: "actor", facilityId: "facility-a" });
  mocks.claim.mockResolvedValue(activeClaim());
  mocks.update.mockResolvedValue({ ...activeClaim(), status: "SUBMITTED" });
  mocks.transaction.mockImplementation(async callback => callback(transaction));
});

describe("claim status changes respect visit cancellation", () => {
  it("reads current facility-scoped claim and parent state inside the serializable write transaction", async () => {
    expect((await request()).status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.claim).toHaveBeenCalledWith({
      where: { id, invoice: { visit: { facilityId: "facility-a" } } },
      include: { invoice: { select: { status: true, visit: { select: { status: true } } } } },
    });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id }, data: expect.objectContaining({ status: "SUBMITTED", notes: "Original record\nDocumented claim action" }) });
  });

  it.each([
    { status: "VOID", visit: { status: "AWAITING_PAYMENT" } },
    { status: "OPEN", visit: { status: "CANCELLED" } },
  ])("rejects claim progression on a closed parent: %j", async invoice => {
    mocks.claim.mockResolvedValue({ ...activeClaim(), invoice });
    expect((await request()).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("does not resurrect a draft claim cancelled after the operator opened the screen", async () => {
    mocks.transaction.mockImplementation(async callback => {
      mocks.claim.mockResolvedValue({ ...activeClaim(), status: "CANCELLED" });
      return callback(transaction);
    });
    expect((await request()).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("allows a valid cancellation to resolve a historical rejected claim on a void invoice", async () => {
    mocks.claim.mockResolvedValue({ ...activeClaim(), status: "REJECTED", invoice: { status: "VOID", visit: { status: "CANCELLED" } } });
    expect((await request("CANCELLED")).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id }, data: expect.objectContaining({ status: "CANCELLED" }) });
  });

  it("preserves the externally controlled SHA status contract", async () => {
    mocks.claim.mockResolvedValue({ ...activeClaim(), payer: "SHA" });
    expect((await request()).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
    expect((await request("CANCELLED")).status).toBe(200);
  });

  it("returns a conflict instead of success if a concurrent cancellation invalidates the transaction", async () => {
    mocks.transaction.mockImplementation(async callback => {
      await callback(transaction);
      throw Object.assign(new Error("Concurrent change"), { code: "P2034" });
    });
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("claim");
  });

  it("rejects another facility's claim without updating it", async () => {
    mocks.claim.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
