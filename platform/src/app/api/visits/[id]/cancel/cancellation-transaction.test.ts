import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { POST } from "./route";

const actor = { id: "staff", facilityId: "facility", sessionId: "session" };
const conflict = (code = "P2010", sql = "40001") => Object.assign(new Error("synthetic abort"), { code, meta: { code: sql } });
const input = { reasonCode: "PATIENT_REQUEST", details: "Patient requested a later appointment" };
const send = (body = input) => POST(new Request("http://localhost/api/visits/visit/cancel", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "visit" }) });
let tx: any, visit: any, pending: any[], committed: any[];
let commitFailure: Error | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  pending = []; committed = []; commitFailure = undefined;
  visit = { id: "visit", facilityId: "facility", appointmentId: "appointment", status: "AWAITING_TRIAGE", priority: "ROUTINE", clinic: "Outpatient", cancellation: null, encounters: [], orders: [], invoice: { id: "invoice", status: "OPEN", payments: [], claims: [] } };
  vi.mocked(requirePermission).mockResolvedValue(actor as any);
  const mutation = (kind: string) => vi.fn(async (args: any) => { pending.push({ kind, args }); return { id: kind, ...args.data }; });
  tx = {
    visit: { findFirst: vi.fn(async () => visit), update: mutation("visit") },
    queueEntry: { updateMany: mutation("queue"), findFirst: vi.fn(async () => ({ servicePoint: "TRIAGE", enteredAt: new Date(Date.now() - 120 * 60000) })) },
    servicePointControl: { findUnique: vi.fn(async () => ({ targetMinutes: 30 })) },
    clinicalOrder: { updateMany: mutation("orders") }, claim: { updateMany: mutation("claims") },
    invoice: { update: mutation("invoice") }, appointment: { updateMany: mutation("appointment") },
    visitCancellation: { create: mutation("cancellation") },
  };
  vi.mocked(appendAudit).mockImplementation(async (_tx, event) => { pending.push({ kind: "audit", event }); return {} as any; });
  // Modeled atomic commit/abort, not native PostgreSQL rollback proof.
  vi.mocked(db.$transaction).mockImplementation(async (work: any) => {
    pending = [];
    const result = await work(tx);
    if (commitFailure) { const error = commitFailure; commitFailure = undefined; throw error; }
    committed.push(...pending);
    return result;
  });
});

it.each([conflict("P2034"), conflict(), conflict("P2010", "40P01")])("retries the complete known-aborted cancellation and commits one attributed record", async error => {
  vi.mocked(appendAudit).mockRejectedValueOnce(error);
  expect((await send()).status).toBe(200);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(tx.visit.findFirst).toHaveBeenCalledTimes(2);
  expect(tx.visit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "visit", facilityId: actor.facilityId } }));
  for (const kind of ["visit", "queue", "orders", "claims", "invoice", "appointment", "cancellation", "audit"]) expect(committed.filter(x => x.kind === kind)).toHaveLength(1);
  expect(committed.find(x => x.kind === "audit").event).toMatchObject({ facilityId: actor.facilityId, userId: actor.id, sessionId: actor.sessionId, entityId: "visit", action: "VISIT_CANCELLED" });
  expect(committed.find(x => x.kind === "cancellation").args.data).toMatchObject({ facilityId: actor.facilityId, visitId: "visit", cancelledById: actor.id, ...input });
  for (const call of vi.mocked(db.$transaction).mock.calls) expect(call[1]).toEqual({ isolationLevel: "Serializable" });
});

it("retries a commit-time abort without duplicating committed effects", async () => {
  commitFailure = conflict();
  expect((await send()).status).toBe(200);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(committed.filter(x => x.kind === "cancellation")).toHaveLength(1);
  expect(committed.filter(x => x.kind === "audit")).toHaveLength(1);
});

it("stops after three aborts and confirms no modeled mutation", async () => {
  vi.mocked(appendAudit).mockRejectedValue(conflict());
  const response = await send();
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(db.$transaction).toHaveBeenCalledTimes(3);
  expect(committed).toEqual([]);
});

it.each([
  ["already cancelled", { cancellation: { id: "existing" } }],
  ["terminal", { status: "DISCHARGED" }],
  ["signed", { encounters: [{ status: "SIGNED" }] }],
  ["corrected", { encounters: [{ status: "CORRECTED" }] }],
  ["delivered", { orders: [{ status: "COMPLETED", displayName: "Service" }] }],
  ["in progress", { orders: [{ status: "IN_PROGRESS" }] }],
  ["payment", { invoice: { id: "invoice", status: "OPEN", payments: [{ status: "CONFIRMED" }], claims: [] } }],
  ["claim", { invoice: { id: "invoice", status: "OPEN", payments: [], claims: [{ status: "SUBMITTED" }] } }],
])("rereads the %s blocker after an abort", async (_name, change) => {
  vi.mocked(appendAudit).mockImplementationOnce(async () => { visit = { ...visit, ...change }; throw conflict(); });
  expect((await send()).status).toBe(409);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(tx.visitCancellation.create).toHaveBeenCalledTimes(1);
  expect(committed).toEqual([]);
});

it("rereads facility visibility after an abort", async () => {
  vi.mocked(appendAudit).mockImplementationOnce(async () => { visit = null; throw conflict(); });
  expect((await send()).status).toBe(404);
  expect(tx.visit.findFirst).toHaveBeenCalledTimes(2);
  expect(committed).toEqual([]);
});

it("rechecks overdue queue status after an abort", async () => {
  vi.mocked(appendAudit).mockImplementationOnce(async () => { tx.queueEntry.findFirst.mockResolvedValue(null); throw conflict(); });
  expect((await send({ ...input, reasonCode: "OVERDUE_UNPROCESSED" })).status).toBe(409);
  expect(tx.queueEntry.findFirst).toHaveBeenCalledTimes(2);
  expect(committed).toEqual([]);
});

it("preserves the SHA emergency safeguard on a later attempt", async () => {
  vi.mocked(appendAudit).mockImplementationOnce(async () => { visit.priority = "URGENT"; throw conflict(); });
  const response = await send({ ...input, reasonCode: "SHA_BENEFIT_OR_ELIGIBILITY", shaOutcome: "BENEFIT_NOT_COVERED", shaEligibilityReference: "synthetic-reference" } as any);
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("Do not delay");
  expect(committed).toEqual([]);
});

it.each([new Error("audit unavailable"), conflict("P2010", "P0001"), conflict("P2002"), conflict("P2003"), conflict("P1001"), Object.assign(new Error("ambiguous transport failure"), { code: "ECONNRESET" })])("never retries unknown, integrity or transport failures", async error => {
  vi.mocked(appendAudit).mockRejectedValue(error);
  expect((await send()).status).toBeGreaterThanOrEqual(400);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(committed).toEqual([]);
});

it.each([401, 403])("rejects denied authority before reading records (%s)", async status => {
  vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status }));
  expect((await send()).status).toBe(status);
  expect(requirePermission).toHaveBeenCalledWith("visit.cancel");
  expect(db.$transaction).not.toHaveBeenCalled();
});

it("rejects invalid input before reading records", async () => {
  expect((await send({ ...input, details: "" })).status).toBe(422);
  expect(db.$transaction).not.toHaveBeenCalled();
});
