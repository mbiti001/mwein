import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn(), auditValueFingerprint: vi.fn().mockReturnValue("digest") }));
vi.mock("@/lib/db", () => ({ db: { visit: { findFirst: vi.fn() }, measuredVitals: { findMany: vi.fn() }, $transaction: vi.fn() } }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { GET, POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const user = { id: "recorder", facilityId: "facility-a", sessionId: "session" };
const request = () => new Request("http://localhost/", { method: "POST", body: JSON.stringify({ measuredAt: "2026-01-01T00:00:00Z", values: { temperatureC: 37 } }) });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(user as any); vi.mocked(db.visit.findFirst).mockResolvedValue({ id } as any); vi.mocked(db.measuredVitals.findMany).mockResolvedValue([]); });
it("allows triage-only reads and falls back to measurement permission only for a normal permission denial", async () => {
  expect((await GET(new Request("http://localhost/"), context)).status).toBe(200);
  expect(requirePermission).toHaveBeenCalledExactlyOnceWith("triage.write");
  vi.mocked(requirePermission).mockClear().mockRejectedValueOnce(Object.assign(new Error("Denied"), { status: 403 }));
  expect((await GET(new Request("http://localhost/"), context)).status).toBe(200);
  expect(requirePermission).toHaveBeenLastCalledWith("vitals.write");
  vi.mocked(requirePermission).mockClear().mockRejectedValueOnce(Object.assign(new Error("MFA required"), { status: 403, code: "MFA_REQUIRED" }));
  expect((await GET(new Request("http://localhost/"), context)).status).toBe(403);
  expect(requirePermission).toHaveBeenCalledTimes(1);
});
it("audits only the 50 measurement records actually disclosed", async () => {
  vi.mocked(db.measuredVitals.findMany).mockResolvedValue(Array.from({ length: 51 }, (_, index) => ({ id: String(index) })) as any);
  const response = await GET(new Request("http://localhost/"), context);
  expect((await response.json()).truncated).toBe(true);
  expect(vi.mocked(recordDisclosure).mock.calls[0][2]).toHaveLength(50);
});
it("scopes reads and withholds data if disclosure audit fails", async () => {
  const response = await GET(new Request("http://localhost/"), context);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(db.visit.findFirst).toHaveBeenCalledWith({ where: { id, facilityId: user.facilityId }, select: { id: true } });
  vi.mocked(recordDisclosure).mockRejectedValue(new Error("Audit unavailable"));
  expect((await GET(new Request("http://localhost/"), context)).status).toBe(500);
});
it("replays only the same actor and payload, without a second measurement even after closure", async () => {
  const requestKey = "22222222-2222-4222-8222-222222222222";
  const body = { requestKey, measuredAt: "2026-01-01T00:00:00Z", values: { temperatureC: 37 } };
  vi.mocked(auditValueFingerprint).mockReturnValue("digest");
  const receipt = { userId: user.id, entityId: "saved", reason: JSON.stringify({ requestKey, requestHash: "digest" }) };
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id, status: "COMPLETED", clinicallyClosedAt: new Date() }]), auditEvent: { findFirst: vi.fn().mockResolvedValue(receipt) }, measuredVitals: { findFirst: vi.fn().mockResolvedValue({ id: "saved" }), create: vi.fn() } };
  vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn(tx));
  const send = () => POST(new Request("http://localhost/", { method: "POST", body: JSON.stringify(body) }), context);
  expect((await send()).status).toBe(201); expect(tx.measuredVitals.create).not.toHaveBeenCalled();
  expect(tx.measuredVitals.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "saved", visitId: id } }));
  expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "VITALS_REPLAY_CONFIRMED", facilityId: user.facilityId, sessionId: user.sessionId }));
  tx.auditEvent.findFirst.mockResolvedValue({ ...receipt, userId: "other" }); expect((await send()).status).toBe(409);
  tx.auditEvent.findFirst.mockResolvedValue(receipt); vi.mocked(auditValueFingerprint).mockReturnValue("changed"); expect((await send()).status).toBe(409);
  vi.mocked(auditValueFingerprint).mockReturnValue("digest"); vi.mocked(appendAudit).mockRejectedValue(new Error("Audit unavailable")); expect((await send()).status).toBe(500);
});
it("denies unauthorized and foreign-facility reads", async () => {
  vi.mocked(db.visit.findFirst).mockResolvedValue(null);
  expect((await GET(new Request("http://localhost/"), context)).status).toBe(404);
  expect(db.measuredVitals.findMany).not.toHaveBeenCalled();
  vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
  expect((await POST(request(), context)).status).toBe(403); expect(db.$transaction).not.toHaveBeenCalled();
});
it.each([{ rows: [] }, { rows: [{ id, status: "COMPLETED", clinicallyClosedAt: null }] }, { rows: [{ id, status: "AWAITING_PAYMENT", clinicallyClosedAt: new Date() }] }])("rejects missing or clinically closed visits before storing measurements", async ({ rows }) => {
  const create = vi.fn();
  vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ $queryRaw: vi.fn().mockResolvedValue(rows), measuredVitals: { create } }));
  expect((await POST(request(), context)).status).toBe(rows.length ? 409 : 404); expect(create).not.toHaveBeenCalled();
});
