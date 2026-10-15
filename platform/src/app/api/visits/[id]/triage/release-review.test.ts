import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn(), auditValueFingerprint: (value: unknown) => JSON.stringify(value) }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn() } }));
import { requirePermission } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { POST } from "./route";

const visitId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const newSetId = "33333333-3333-4333-8333-333333333333";
const requestKey = "44444444-4444-4444-8444-444444444444";
const actor = { id: "nurse-a", facilityId: "facility-a", sessionId: "session-a", facility: { timezone: "Africa/Nairobi" } };
const values = { temperatureC: 37.2, pulseBpm: 84, respiratoryRate: 18, systolicBp: 118, diastolicBp: 76, oxygenSaturation: 98, weightKg: 70, heightCm: 172 };
const original = { id: sourceId, values: { ...values }, measuredAt: new Date("2026-01-01T07:00:00Z"), recordedBy: { displayName: "Original recorder" } };
const payload = () => ({ ...values, requestKey, reviewedVitalsId: sourceId, chiefComplaint: "Synthetic assessment", painScore: 0, consciousness: "ALERT", triageCategory: "ROUTINE" });
const visit = () => ({ id: visitId, facilityId: actor.facilityId, status: "AWAITING_TRIAGE", priority: "ROUTINE", clinicallyClosedAt: null, triage: null, queues: [{ id: "triage-queue" }] });
const tx = {
  $queryRaw: vi.fn(),
  visit: { findFirst: vi.fn(), update: vi.fn() },
  measuredVitals: { findFirst: vi.fn(), create: vi.fn() },
  triageRecord: { create: vi.fn() },
  queueEntry: { updateMany: vi.fn(), create: vi.fn() },
  auditEvent: { findFirst: vi.fn() },
};
const submit = (body: unknown = payload()) => POST(new Request("http://localhost/api/visits/" + visitId + "/triage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: visitId }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockReset().mockResolvedValue(actor as any);
  vi.mocked(appendAudit).mockReset().mockResolvedValue(undefined as any);
  vi.mocked(db.$transaction).mockImplementation(async (work: any) => work(tx));
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: visitId }]);
  tx.visit.findFirst.mockReset().mockResolvedValue(visit());
  tx.visit.update.mockReset().mockResolvedValue({ ...visit(), status: "AWAITING_CLINICIAN" });
  tx.measuredVitals.findFirst.mockReset().mockResolvedValue(structuredClone(original));
  tx.measuredVitals.create.mockReset().mockResolvedValue({ id: newSetId });
  tx.triageRecord.create.mockReset().mockResolvedValue({ id: "assessment" });
  tx.queueEntry.updateMany.mockReset().mockResolvedValue({ count: 1 });
  tx.queueEntry.create.mockReset().mockResolvedValue({ id: "consultation-queue" });
  tx.auditEvent.findFirst.mockReset().mockResolvedValue(null);
});

describe("independent release review: shared measurements and clinical handoff", () => {
  it("reuses a complete saved set without writing a duplicate measurement", async () => {
    const result = await submit();
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(tx.measuredVitals.create).not.toHaveBeenCalled();
    expect(tx.measuredVitals.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: sourceId, visitId } }));
    expect(tx.triageRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ visitId, reviewedVitalsId: sourceId }) }));
    expect(tx.queueEntry.create).toHaveBeenCalledOnce();
    expect(tx.queueEntry.create).toHaveBeenCalledWith({ data: { visitId, servicePoint: "CONSULTATION", priority: "ROUTINE", status: "WAITING" } });
    expect(tx.visit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: visitId, facilityId: actor.facilityId } }));
  });

  it("completes only missing values in one new set with original source attribution", async () => {
    const partial = { ...original, values: { temperatureC: values.temperatureC, pulseBpm: values.pulseBpm } };
    tx.measuredVitals.findFirst.mockResolvedValue(partial);
    const body = { ...payload(), measuredAt: "2026-01-01T07:30:00Z" };
    expect((await submit(body)).status).toBe(200);
    expect(tx.measuredVitals.create).toHaveBeenCalledOnce();
    const saved = tx.measuredVitals.create.mock.calls[0][0].data;
    expect(saved.values).toEqual(values);
    expect(saved.recordedById).toBe(actor.id);
    expect(saved.measuredAt).toEqual(new Date(body.measuredAt));
    expect(saved.note).toContain(sourceId);
    expect(saved.note).toContain("Original recorder");
    expect(saved.note).toContain(original.measuredAt.toISOString());
    expect(partial.values).toEqual({ temperatureC: 37.2, pulseBpm: 84 });
    expect(tx.triageRecord.create.mock.calls[0][0].data.reviewedVitalsId).toBe(newSetId);
    const measurementAudit = vi.mocked(appendAudit).mock.calls.map(call => call[1]).find(event => event.action === "VITALS_MEASURED");
    expect(JSON.parse(measurementAudit!.reason!)).toMatchObject({ completedFrom: sourceId });
  });

  it.each(["temperatureC", "pulseBpm", "heightCm"] as const)("rejects changing saved %s while claiming source reuse", async key => {
    const body = payload(); body[key] += 1;
    expect((await submit(body)).status).toBe(409);
    expect(tx.measuredVitals.create).not.toHaveBeenCalled();
    expect(tx.triageRecord.create).not.toHaveBeenCalled();
    expect(tx.queueEntry.create).not.toHaveBeenCalled();
  });

  it("rejects a source set belonging to another visit", async () => {
    tx.measuredVitals.findFirst.mockResolvedValue(null);
    expect((await submit()).status).toBe(422);
    expect(tx.triageRecord.create).not.toHaveBeenCalled();
  });

  it("records new readings and triage in the same transaction when no source set exists", async () => {
    const { reviewedVitalsId: _source, ...body } = payload();
    expect((await submit(body)).status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.measuredVitals.create).toHaveBeenCalledOnce();
    expect(tx.triageRecord.create.mock.calls[0][0].data.reviewedVitalsId).toBe(newSetId);
    expect(vi.mocked(appendAudit).mock.calls.map(call => call[1].action)).toEqual(["VITALS_MEASURED", "TRIAGE_COMPLETED"]);
  });

  it("recognizes the same actor/payload/key retry without creating another record or queue", async () => {
    expect((await submit()).status).toBe(200);
    const receipt = vi.mocked(appendAudit).mock.calls.map(call => call[1]).find(event => event.action === "TRIAGE_COMPLETED")!;
    tx.visit.findFirst.mockResolvedValue({ ...visit(), status: "AWAITING_CLINICIAN", triage: { id: "retained" } });
    tx.auditEvent.findFirst.mockResolvedValue(receipt);
    tx.triageRecord.create.mockClear(); tx.queueEntry.create.mockClear(); tx.measuredVitals.create.mockClear();
    const result = await submit();
    expect(result.status).toBe(200); expect((await result.json()).replayed).toBe(true);
    expect(tx.triageRecord.create).not.toHaveBeenCalled(); expect(tx.queueEntry.create).not.toHaveBeenCalled(); expect(tx.measuredVitals.create).not.toHaveBeenCalled();
    expect(tx.auditEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facilityId: actor.facilityId, userId: actor.id, entityId: visitId }) }));
  });

  it.each(["payload", "actor", "key"])("rejects a completed-assessment retry with changed %s", async changed => {
    await submit();
    const receipt = vi.mocked(appendAudit).mock.calls.map(call => call[1]).find(event => event.action === "TRIAGE_COMPLETED")!;
    tx.visit.findFirst.mockResolvedValue({ ...visit(), triage: { id: "retained" } });
    tx.auditEvent.findFirst.mockResolvedValue(receipt);
    const body = payload();
    if (changed === "payload") body.chiefComplaint = "Different clinical content";
    if (changed === "actor") vi.mocked(requirePermission).mockResolvedValue({ ...actor, id: "another-nurse" } as any);
    if (changed === "key") body.requestKey = "55555555-5555-4555-8555-555555555555";
    tx.triageRecord.create.mockClear(); tx.queueEntry.create.mockClear();
    expect((await submit(body)).status).toBe(409);
    expect(tx.triageRecord.create).not.toHaveBeenCalled(); expect(tx.queueEntry.create).not.toHaveBeenCalled();
  });

  it("denies reception-only access before opening a transaction", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Permission denied"), { status: 403 }));
    expect((await submit()).status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("triage.write"); expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does not read or mutate a visit outside the caller facility", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    expect((await submit()).status).toBe(404);
    expect(tx.visit.findFirst).not.toHaveBeenCalled(); expect(tx.triageRecord.create).not.toHaveBeenCalled();
  });

  it("rejects newly completed triage after clinical closure", async () => {
    tx.visit.findFirst.mockResolvedValue({ ...visit(), clinicallyClosedAt: new Date() });
    expect((await submit()).status).toBe(409); expect(tx.measuredVitals.create).not.toHaveBeenCalled(); expect(tx.triageRecord.create).not.toHaveBeenCalled();
  });

  it("does not report successful completion when audit retention rejects the transaction", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("Synthetic audit retention failure"));
    expect((await submit()).status).toBe(500);
    // Database rollback is covered by real synthetic transaction checks, not asserted by these mocks.
  });
});
