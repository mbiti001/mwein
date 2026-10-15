import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn(), auditValueFingerprint: (value: unknown) => JSON.stringify(value) }));
vi.mock("@/lib/workflow-transaction", () => ({ workflowTransaction: vi.fn() }));
import { requirePermission } from "@/lib/auth";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { workflowTransaction } from "@/lib/workflow-transaction";
import { POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111", sourceId = "22222222-2222-4222-8222-222222222222", newId = "33333333-3333-4333-8333-333333333333", requestKey = "44444444-4444-4444-8444-444444444444";
const values = { temperatureC: 37.2, pulseBpm: 84, respiratoryRate: 18, systolicBp: 118, diastolicBp: 76, oxygenSaturation: 98, weightKg: 70 };
const input = { requestKey, measuredAt: "2026-01-01T01:00:00.000Z", chiefComplaint: "Synthetic assessment", ...values, painScore: 1, consciousness: "ALERT", triageCategory: "ROUTINE" };
const user = { id: "nurse", facilityId: "facility-a", sessionId: "session", facility: { timezone: "Africa/Nairobi" } };
const context = { params: Promise.resolve({ id }) };
const visit = { id, status: "AWAITING_TRIAGE", priority: "ROUTINE", clinicallyClosedAt: null, triage: null, queues: [{ id: "queue" }] };
let tx: any;
const send = (body: object = input) => POST(new Request("http://localhost/", { method: "POST", body: JSON.stringify(body) }), context);
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(user as any);
  tx = { $queryRaw: vi.fn().mockResolvedValue([{ id }]), visit: { findFirst: vi.fn().mockResolvedValue(visit), update: vi.fn().mockResolvedValue({ id, status: "AWAITING_CLINICIAN", priority: "ROUTINE" }) }, measuredVitals: { findFirst: vi.fn().mockResolvedValue({ id: sourceId, values, measuredAt: new Date("2026-01-01T00:00:00Z"), recordedBy: { displayName: "Reception recorder" } }), create: vi.fn().mockResolvedValue({ id: newId }) }, triageRecord: { create: vi.fn() }, queueEntry: { updateMany: vi.fn(), create: vi.fn() }, auditEvent: { findFirst: vi.fn() } };
  vi.mocked(workflowTransaction).mockImplementation(async work => work(tx));
});
it("reuses a complete unchanged set without creating another measurement and records facility/session evidence", async () => {
  const response = await send({ ...input, reviewedVitalsId: sourceId });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(requirePermission).toHaveBeenCalledWith("triage.write"); expect(tx.measuredVitals.create).not.toHaveBeenCalled();
  expect(tx.measuredVitals.findFirst.mock.calls[0][0].where).toEqual({ id: sourceId, visitId: id });
  expect(tx.triageRecord.create.mock.calls[0][0].data.reviewedVitalsId).toBe(sourceId);
  expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "TRIAGE_COMPLETED", facilityId: user.facilityId, sessionId: user.sessionId }));
});
it("records new measurements once in the same transaction as clinical triage", async () => {
  expect((await send()).status).toBe(200); expect(tx.measuredVitals.create).toHaveBeenCalledTimes(1);
  expect(tx.measuredVitals.create.mock.calls[0][0].data).toMatchObject({ visitId: id, recordedById: user.id, values });
  expect(tx.triageRecord.create.mock.calls[0][0].data.reviewedVitalsId).toBe(newId);
});
it("completes a partial source in one linked set, retaining original recorder/time and added field names", async () => {
  tx.measuredVitals.findFirst.mockResolvedValue({ id: sourceId, values: { temperatureC: 37.2 }, measuredAt: new Date("2026-01-01T00:00:00Z"), recordedBy: { displayName: "Reception recorder" } });
  expect((await send({ ...input, reviewedVitalsId: sourceId })).status).toBe(200);
  const saved = tx.measuredVitals.create.mock.calls[0][0].data;
  expect(saved.note).toContain(sourceId); expect(saved.note).toContain("2026-01-01T00:00:00.000Z"); expect(saved.note).toContain("Reception recorder"); expect(saved.note).toContain("Pulse /min");
  const audit = vi.mocked(appendAudit).mock.calls.find(([, event]) => event.action === "VITALS_MEASURED")![1];
  expect(JSON.parse(audit.reason!).completedFrom).toBe(sourceId);
});
it("rejects changed source readings or a source from another visit", async () => {
  expect((await send({ ...input, reviewedVitalsId: sourceId, pulseBpm: 90 })).status).toBe(409);
  tx.measuredVitals.findFirst.mockResolvedValue(null);
  expect((await send({ ...input, reviewedVitalsId: sourceId })).status).toBe(422);
  expect(tx.measuredVitals.create).not.toHaveBeenCalled(); expect(tx.triageRecord.create).not.toHaveBeenCalled();
});
it("confirms an exact retry after clinical progression without repeating clinical writes", async () => {
  tx.visit.findFirst.mockResolvedValue({ ...visit, status: "IN_CONSULTATION", triage: { id: "existing" } });
  tx.auditEvent.findFirst.mockResolvedValue({ reason: JSON.stringify({ requestKey, requestHash: auditValueFingerprint({ visitId: id, actorId: user.id, input }) }) });
  const response = await send(); expect(response.status).toBe(200); expect((await response.json()).replayed).toBe(true);
  expect(tx.auditEvent.findFirst.mock.calls[0][0].where).toMatchObject({ facilityId: user.facilityId, userId: user.id, entityId: id });
  expect(tx.triageRecord.create).not.toHaveBeenCalled(); expect(tx.measuredVitals.create).not.toHaveBeenCalled(); expect(tx.queueEntry.create).not.toHaveBeenCalled();
});
it.each(["changed body", "changed key", "different actor"])("does not replay a receipt with %s", async variant => {
  tx.visit.findFirst.mockResolvedValue({ ...visit, triage: { id: "existing" } });
  tx.auditEvent.findFirst.mockResolvedValue(variant === "different actor" ? null : { reason: JSON.stringify({ requestKey, requestHash: auditValueFingerprint({ visitId: id, actorId: user.id, input }) }) });
  const body = variant === "changed body" ? { ...input, painScore: 2 } : variant === "changed key" ? { ...input, requestKey: sourceId } : input;
  expect((await send(body)).status).toBe(409); expect(tx.triageRecord.create).not.toHaveBeenCalled();
});
it("rejects unauthorized, foreign-facility and clinically closed visits before writes", async () => {
  vi.mocked(requirePermission).mockRejectedValueOnce(Object.assign(new Error("Denied"), { status: 403 }));
  expect((await send()).status).toBe(403); expect(workflowTransaction).not.toHaveBeenCalled();
  tx.$queryRaw.mockResolvedValueOnce([]); expect((await send()).status).toBe(404);
  expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([id, user.facilityId]);
  tx.visit.findFirst.mockResolvedValue({ ...visit, clinicallyClosedAt: new Date() });
  expect((await send()).status).toBe(409); expect(tx.measuredVitals.create).not.toHaveBeenCalled();
});
it("fails the transaction when measurement attribution cannot be audited", async () => {
  vi.mocked(appendAudit).mockRejectedValue(new Error("Audit unavailable"));
  expect((await send()).status).toBe(500); expect(tx.triageRecord.create).not.toHaveBeenCalled();
});

it("persists only each observation's own abnormal and critical flags", async () => {
  const response = await send({ ...input, heightCm: 172, painScore: 8, oxygenSaturation: 88 });
  expect(response.status).toBe(200);
  const observations = tx.triageRecord.create.mock.calls[0][0].data.observations.create;
  expect(observations).toHaveLength(10);
  expect(observations.filter((item: any) => item.abnormal).map((item: any) => item.code)).toEqual(["SPO2", "PAIN"]);
  expect(observations.filter((item: any) => item.critical).map((item: any) => item.code)).toEqual(["SPO2"]);
  expect(observations.find((item: any) => item.code === "WEIGHT")).toMatchObject({ abnormal: false, critical: false });
  expect((await response.json()).alerts).toHaveLength(2);
});

it.each(["", null, false])("rejects unobserved pain %j before clinical writes", async painScore => {
  expect((await send({ ...input, painScore })).status).toBe(422);
  expect(workflowTransaction).not.toHaveBeenCalled();
  expect(tx.triageRecord.create).not.toHaveBeenCalled();
});
