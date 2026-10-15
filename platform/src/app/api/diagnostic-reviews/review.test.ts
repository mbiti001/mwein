import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", async original => ({ ...await original<typeof import("@/lib/audit")>(), appendAudit: vi.fn() }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn(), $queryRaw: vi.fn(), clinicalOrder: { findFirst: vi.fn(), findMany: vi.fn() }, diagnosticReview: { findUnique: vi.fn(), create: vi.fn() } } }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { GET as list } from "./route";
import { GET, POST } from "../orders/[id]/diagnostic-review/route";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", actorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", eventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const resultId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestKey = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const actor = { id: actorId, sessionId: "session", facilityId: "facility", permissions: ["clinical.results.read", "encounter.write"] };
const context = { params: Promise.resolve({ id }) }, verifiedAt = "2026-10-15T10:00:00.000Z";
const claim = { action: "CLAIM", expectedEventId: null, requestKey, note: "Synthetic review responsibility" };
const ack = { action: "ACKNOWLEDGE", expectedEventId: eventId, requestKey, note: "Synthetic review and next step", resultId, verifiedAt, attested: true };
const owner = { id: eventId, sequence: 1, action: "CLAIM", actor: { id: actorId, displayName: "Synthetic clinician" } };
function order(events: unknown[] = []) { return { id, status: "COMPLETED", visit: { id: "visit", status: "DISCHARGED", clinicallyClosedAt: new Date() }, diagnosticReviews: events, laboratory: { result: { id: resultId, verifiedAt: new Date(verifiedAt) } }, imaging: null }; }
const request = (body: unknown) => new Request("http://localhost/api/orders/test/diagnostic-review", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(actor as never);
  vi.mocked(db.$transaction).mockImplementation(async callback => (callback as any)(db));
  vi.mocked(db.$queryRaw).mockResolvedValue([{ id }]);
  vi.mocked(db.clinicalOrder.findFirst).mockResolvedValue(order() as never);
  vi.mocked(db.clinicalOrder.findMany).mockResolvedValue([]);
  vi.mocked(db.diagnosticReview.create).mockResolvedValue({ id: eventId } as never);
});
describe("diagnostic review authorization, ownership and evidence", () => {
  it("locks the facility-scoped order and records ownership on a closed visit atomically with audit", async () => {
    expect((await POST(request(claim), context)).status).toBe(201);
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(vi.mocked(db.$queryRaw).mock.calls[0].slice(1)).toEqual([id, actor.facilityId]);
    expect(db.clinicalOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, visit: { facilityId: actor.facilityId }, type: { in: ["LABORATORY", "IMAGING"] } } }));
    expect(db.diagnosticReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orderId: id, actorId, sequence: 1, action: "CLAIM" }) });
    expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: "DIAGNOSTIC_REVIEW_CLAIMED", facilityId: actor.facilityId, userId: actorId, sessionId: actor.sessionId }));
  });
  it.each(["read", "write"])("rejects missing %s permission before database access", async mode => {
    if (mode === "write") vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("denied"), { status: 403 }));
    else vi.mocked(requirePermission).mockResolvedValue({ ...actor, permissions: ["encounter.write"] } as never);
    expect((await POST(request(claim), context)).status).toBe(403); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("rejects a missing/other-facility order before reading its events", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([]);
    expect((await POST(request(claim), context)).status).toBe(404); expect(db.clinicalOrder.findFirst).not.toHaveBeenCalled();
  });
  it.each([{ ...claim, expectedEventId: undefined }, { ...claim, note: " " }, { ...claim, ownerId: actorId }, { ...ack, attested: false }])("rejects incomplete or injected evidence: %j", async body => {
    expect((await POST(request(body), context)).status).toBe(422); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("rejects a stale ownership revision without appending an event", async () => {
    vi.mocked(db.clinicalOrder.findFirst).mockResolvedValue(order([owner]) as never);
    expect((await POST(request(claim), context)).status).toBe(409); expect(db.diagnosticReview.create).not.toHaveBeenCalled();
  });
  it("requires the accepting clinician to acknowledge the exact released report", async () => {
    vi.mocked(db.clinicalOrder.findFirst).mockResolvedValue(order([owner]) as never);
    expect((await POST(request(ack), context)).status).toBe(201);
    expect(db.diagnosticReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ resultId, verifiedAt: new Date(verifiedAt), sequence: 2 }) });
  });
  it.each(["unclaimed", "other-owner", "unreleased", "different-result", "already-acknowledged", "cancelled"])("rejects %s acknowledgement", async mode => {
    const value = order([owner]);
    if (mode === "unclaimed") value.diagnosticReviews = [];
    if (mode === "other-owner") value.diagnosticReviews = [{ ...owner, actor: { id: "other" } }];
    if (mode === "unreleased") value.laboratory = { result: null } as any;
    if (mode === "different-result") value.laboratory.result.id = eventId;
    if (mode === "already-acknowledged") value.diagnosticReviews = [{ ...owner, action: "ACKNOWLEDGE" }];
    if (mode === "cancelled") value.status = "CANCELLED";
    vi.mocked(db.clinicalOrder.findFirst).mockResolvedValue(value as never);
    expect((await POST(request(ack), context)).status).toBe(409); expect(db.diagnosticReview.create).not.toHaveBeenCalled();
  });
  it("confirms only an exact same-actor replay, audits it and does not append another review", async () => {
    vi.mocked(db.diagnosticReview.findUnique).mockResolvedValue({ id: eventId, orderId: id, actorId, requestHash: auditValueFingerprint({ orderId: id, actorId, input: claim }) } as never);
    const response = await POST(request(claim), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ eventId, replayed: true });
    expect(db.diagnosticReview.create).not.toHaveBeenCalled(); expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: "DIAGNOSTIC_REVIEW_REPLAYED" }));
    expect((await POST(request({ ...claim, note: "Changed request" }), context)).status).toBe(409);
    vi.mocked(db.diagnosticReview.findUnique).mockResolvedValue({ id: eventId, orderId: id, actorId: "someone-else", requestHash: auditValueFingerprint({ orderId: id, actorId, input: claim }) } as never);
    expect((await POST(request(claim), context)).status).toBe(409);
  });
  it("propagates audit failure from the transaction without claiming a successful save", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("audit failed"));
    expect((await POST(request(claim), context)).status).toBe(500);
  });
  it("bounds history and fails closed on disclosure audit failure", async () => {
    vi.mocked(db.clinicalOrder.findFirst).mockResolvedValue(order(Array.from({ length: 51 }, () => owner)) as never);
    const response = await GET(new Request("http://localhost"), context);
    const body = await response.json(); expect(body.order.diagnosticReviews).toHaveLength(50); expect(body.historyTruncated).toBe(true);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(recordClinicalAccess).toHaveBeenCalledWith(actor, "DIAGNOSTIC_REVIEW", [{ type: "Visit", id: "visit" }]);
    vi.mocked(recordClinicalAccess).mockRejectedValue(new Error("audit failed"));
    expect((await GET(new Request("http://localhost"), context)).status).toBe(500);
  });
  it("lists only facility-scoped outstanding work, includes closed visits and visibly bounds reads", async () => {
    vi.mocked(db.clinicalOrder.findMany).mockResolvedValue(Array.from({ length: 101 }, () => order()) as never);
    const response = await list(new Request("http://localhost/api/diagnostic-reviews?state=RELEASED"));
    const body = await response.json(); expect(body.orders).toHaveLength(100); expect(body.truncated).toBe(true);
    const query = vi.mocked(db.clinicalOrder.findMany).mock.calls[0][0] as any;
    expect(query.where.visit).toEqual({ facilityId: actor.facilityId });
    expect(query.where.diagnosticReviews).toEqual({ none: { action: "ACKNOWLEDGE" } });
    expect(query.where.OR[0].laboratory.is.result.is).toEqual({ status: "VERIFIED", verifiedAt: { not: null } });
    expect(query.take).toBe(101); expect(query.orderBy).toEqual([{ requestedAt: "asc" }, { id: "asc" }]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    vi.mocked(recordClinicalAccess).mockRejectedValue(new Error("audit failed"));
    expect((await list(new Request("http://localhost/api/diagnostic-reviews"))).status).toBe(500);
  });
  it("keeps acknowledged history accessible and rejects unsupported filters", async () => {
    expect((await list(new Request("http://localhost/api/diagnostic-reviews?state=ACKNOWLEDGED"))).status).toBe(200);
    expect(vi.mocked(db.clinicalOrder.findMany).mock.calls[0][0]?.where?.diagnosticReviews).toEqual({ some: { action: "ACKNOWLEDGE" } });
    expect((await list(new Request("http://localhost/api/diagnostic-reviews?state=INVALID"))).status).toBe(422);
  });
});
