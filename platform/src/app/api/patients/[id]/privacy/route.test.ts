import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { patient: { findFirst: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn(), auditValueFingerprint: vi.fn() }));
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { POST } from "./route";
const user = { id: "dpo", facilityId: "facility-a", sessionId: "session" };
const params = { params: Promise.resolve({ id: "patient" }) };
const create = vi.fn();
const findFirst = vi.fn();
const update = vi.fn();
const lock = vi.fn();
const requestId = "11111111-1111-4111-8111-111111111111";
const responseReference = "audit:22222222-2222-4222-8222-222222222222";
const deliver = { action: "CONFIRM_DELIVERY", requestId, responseEvidenceReference: responseReference, recipientKind: "PATIENT", recipientReference: "patient-ref", identityEvidenceReference: "identity-check-ref", method: "IN_PERSON", deliveryEvidenceReference: "receipt-ref", resolution: "Reviewed response delivered to patient", attested: true };
const postBody = (body: object) => POST(new Request("http://localhost/api/patients/patient/privacy", { method: "POST", body: JSON.stringify(body) }), params);
const post = (extra: object = {}) => POST(new Request("http://localhost/api/patients/patient/privacy", { method: "POST", body: JSON.stringify({ action: "CREATE_REQUEST", type: "ACCESS", details: "Patient requests access to their record", ...extra }) }), params);
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  vi.mocked(requirePermission).mockResolvedValue(user as any);
  vi.mocked(db.patient.findFirst).mockResolvedValue({ id: "patient" } as any);
  create.mockImplementation(async ({ data }) => ({ ...data, id: "request", status: "RECEIVED" }));
  findFirst.mockResolvedValue({ id: requestId, type: "ACCESS", status: "IN_REVIEW", responsePreparedAt: new Date("2026-10-15T09:00:00Z"), responseEvidenceReference: responseReference });
  update.mockImplementation(async ({ data }) => ({ id: requestId, ...data }));
  vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ $queryRaw: lock, dataSubjectRequest: { create, findFirst, update } }));
});

describe("confirmed response delivery", () => {
  it("locks the scoped request, retains recipient evidence and appends attributed evidence atomically", async () => {
    const response = await postBody(deliver);
    expect(response.status).toBe(200);
    expect(lock).toHaveBeenCalledOnce();
    expect(lock.mock.calls[0].slice(1)).toEqual([requestId, "patient", user.facilityId]);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: requestId, patientId: "patient", facilityId: user.facilityId } });
    expect(update).toHaveBeenCalledWith({ where: { id: requestId }, data: expect.objectContaining({ status: "COMPLETED", deliveryEvidence: expect.objectContaining({ recipientReference: "patient-ref", recordedById: user.id, deliveredAt: "2026-10-15T10:00:00.000Z", responseEvidenceReference: responseReference }) }) });
    expect(appendAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: user.id, sessionId: user.sessionId, action: "DATA_SUBJECT_RESPONSE_DELIVERY_RECORDED", beforeHash: responseReference }));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each([{ attested: false }, { identityEvidenceReference: "" }, { recipientKind: "AUTHORIZED_REPRESENTATIVE" }, { deliveryEvidenceReference: "" }, { deliveredAt: "2099-01-01T00:00:00Z" }])("rejects missing/invalid delivery evidence: %j", async extra => {
    expect((await postBody({ ...deliver, ...extra })).status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });
  it.each([{ status: "COMPLETED" }, { status: "CANCELLED" }, { status: "DENIED" }, { responsePreparedAt: null }, { responseEvidenceReference: "audit:different" }, { type: "CORRECTION" }])("rejects stale or invalid delivery state: %j", async extra => {
    findFirst.mockResolvedValue({ id: requestId, type: "ACCESS", status: "IN_REVIEW", responsePreparedAt: new Date("2026-10-15T09:00:00Z"), responseEvidenceReference: responseReference, ...extra });
    expect((await postBody(deliver)).status).toBe(409); expect(update).not.toHaveBeenCalled();
  });
  it("rejects delivery before preparation and generic completion bypass", async () => {
    expect((await postBody({ ...deliver, deliveredAt: "2026-10-15T08:00:00Z" })).status).toBe(422);
    expect((await postBody({ action: "UPDATE_REQUEST", requestId, status: "COMPLETED", resolution: "Bypass delivery", evidenceReference: "unrelated-evidence" })).status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });
  it("does not confirm completion if the transactional audit fails", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("audit unavailable"));
    const response = await postBody(deliver);
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("record");
  });
  it("requires permission and hides a foreign request", async () => {
    findFirst.mockResolvedValue(null);
    expect((await postBody(deliver)).status).toBe(404); expect(update).not.toHaveBeenCalled();
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    lock.mockClear(); expect((await postBody(deliver)).status).toBe(403); expect(lock).not.toHaveBeenCalled();
  });
});
afterEach(() => vi.useRealTimers());
describe("rights intake deadlines and boundaries", () => {
  it.each([["ACCESS", 7], ["CORRECTION", 14], ["PORTABLE_EXPORT", 30], ["DISCLOSURE", 7]])("sets %s target on the server", async (type, days) => {
    const response = await post({ type });
    expect(response.status).toBe(200);
    const { record } = await response.json();
    expect(new Date(record.dueAt).getTime() - new Date(record.requestedAt).getTime()).toBe(Number(days) * 86_400_000);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ facilityId: user.facilityId, patientId: "patient", createdById: user.id, updatedById: user.id }) });
    expect(appendAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: user.id, sessionId: user.sessionId, afterHash: `${type}:RECEIVED:${record.requestedAt}:${record.dueAt}` }));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("accepts late intake using original receipt and preserves an already overdue deadline", async () => {
    const response = await post({ receivedAt: "2026-09-25T12:00:00+03:00" });
    expect(response.status).toBe(200);
    expect((await response.json()).record).toMatchObject({ requestedAt: "2026-09-25T09:00:00.000Z", dueAt: "2026-10-02T09:00:00.000Z" });
  });
  it.each([{ dueAt: "2099-01-01T00:00:00Z" }, { receivedAt: "2099-01-01T00:00:00Z" }, { receivedAt: "invalid" }, { requestedAt: "2099-01-01T00:00:00Z" }])("rejects deadline overrides and invalid receipt before mutation: %j", async (extra) => {
    expect((await post(extra)).status).toBe(422);
    expect(create).not.toHaveBeenCalled(); expect(appendAudit).not.toHaveBeenCalled();
  });
  it("denies unauthorized staff before looking up patients", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    expect((await post()).status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("privacy.manage"); expect(db.patient.findFirst).not.toHaveBeenCalled();
  });
  it("hides patients outside the session facility", async () => {
    vi.mocked(db.patient.findFirst).mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(db.patient.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "patient", facilityId: user.facilityId } }));
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("rejects the transaction when attribution cannot be audited", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("audit unavailable"));
    const response = await post();
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("record");
    expect(db.$transaction).toHaveBeenCalledOnce();
  });
});
