import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), visit: vi.fn(), audit: vi.fn(), access: vi.fn(), transaction: vi.fn(), receipt: vi.fn(), queue: vi.fn(), update: vi.fn(), disposition: vi.fn(), cancel: vi.fn(), task: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/audit", () => ({ appendAudit: mocks.audit }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: mocks.access }));
vi.mock("@/lib/db", () => ({ db: { visit: { findFirst: mocks.visit }, $transaction: mocks.transaction } }));
import { GET, POST } from "./route";
import { dischargeRevision, dischargeRequestFingerprint } from "@/lib/discharge-review";
const actor = { id: "clinician", facilityId: "facility", sessionId: "session" };
const visit = { id: "visit", visitNumber: "V-1", status: "AWAITING_PAYMENT", priority: "ROUTINE", clinicallyClosedAt: null, encounters: [{ id: "encounter", status: "SIGNED" }], orders: [], dispositionRecord: null };
const input = { requestKey: "3b321d22-3255-484d-8be3-4e74f32aab2a", expectedRevision: dischargeRevision(visit), outcome: "OUTPATIENT", details: "Follow-up and handover documented", cancelPendingOrders: false };
const context = { params: Promise.resolve({ id: "visit" }) };
const post = (body = input) => POST(new Request("http://localhost/discharge", { method: "POST", body: JSON.stringify(body) }), context);
beforeEach(() => {
  vi.resetAllMocks(); mocks.permission.mockResolvedValue(actor); mocks.visit.mockResolvedValue(visit);
  mocks.transaction.mockImplementation(work => work({ visit: { findFirst: mocks.visit, update: mocks.update }, auditEvent: { findFirst: mocks.receipt }, queueEntry: { updateMany: mocks.queue, findFirst: vi.fn().mockResolvedValue(null), create: mocks.task }, visitDisposition: { upsert: mocks.disposition }, clinicalOrder: { updateMany: mocks.cancel } }));
  mocks.update.mockResolvedValue({ ...visit, status: "DISCHARGED", clinicallyClosedAt: new Date() });
  mocks.disposition.mockResolvedValue({ outcome: "OUTPATIENT", recordedById: actor.id });
});
it("audits a facility-scoped discharge review before private disclosure", async () => {
  const result = await GET(new Request("http://localhost/discharge"), context);
  expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
  expect(mocks.visit).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "visit", facilityId: "facility" } }));
  expect(mocks.access).toHaveBeenCalledWith(actor, "DISCHARGE_REVIEW", [{ type: "Visit", id: "visit" }]);
});
it("withholds a review when the access audit fails", async () => {
  mocks.access.mockRejectedValue(new Error("Audit failed")); expect((await GET(new Request("http://localhost/discharge"), context)).status).toBe(500);
});
it("requires current clinical permission before a read or mutation", async () => {
  mocks.permission.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
  expect((await post()).status).toBe(403); expect((await GET(new Request("http://localhost/discharge"), context)).status).toBe(403);
  expect(mocks.visit).not.toHaveBeenCalled();
});
it("does not mutate or disclose a foreign visit", async () => {
  mocks.visit.mockResolvedValue(null); expect((await post()).status).toBe(404); expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.task).not.toHaveBeenCalled();
});
it("rejects a stale review before any cancellation or closure", async () => {
  mocks.visit.mockResolvedValue({ ...visit, orders: [{ id: "new", status: "REQUESTED" }] });
  expect((await post({ ...input, cancelPendingOrders: true })).status).toBe(409); expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it("preserves billing work and records attributable clinical closure", async () => {
  expect((await post()).status).toBe(200);
  expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ servicePoint: { not: "BILLING" } }) }));
  expect(mocks.task).toHaveBeenCalledWith({ data: { visitId: "visit", priority: "ROUTINE", servicePoint: "BILLING" } });
  expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ facilityId: "facility", userId: "clinician", sessionId: "session", action: "VISIT_CLINICALLY_CLOSED" }));
});
it("recovers the exact actor-bound request without closing twice", async () => {
  mocks.visit.mockResolvedValue({ ...visit, status: "DISCHARGED", clinicallyClosedAt: new Date(), dispositionRecord: { outcome: "OUTPATIENT" } });
  mocks.receipt.mockResolvedValue({ reason: JSON.stringify({ requestKey: input.requestKey, requestFingerprint: dischargeRequestFingerprint(input) }) });
  const response = await post(); expect(response.status).toBe(200); expect(await response.json()).toHaveProperty("replayed", true);
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
  expect(mocks.receipt).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: actor.id, facilityId: actor.facilityId, entityId: "visit" }) }));
  expect((await post({ ...input, details: "Changed follow-up and handover" })).status).toBe(409);
});
it("bounds retries after a competing department changes the visit", async () => {
  mocks.transaction.mockRejectedValue({ code: "P2034" }); expect((await post()).status).toBe(409); expect(mocks.transaction).toHaveBeenCalledTimes(3);
});
