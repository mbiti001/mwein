import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn(), auditValueFingerprint: vi.fn().mockReturnValue("digest") }));
vi.mock("@/lib/db", () => ({ db: { visit: { findFirst: vi.fn() }, measuredVitals: { findMany: vi.fn() }, $transaction: vi.fn() } }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { GET, POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const user = { id: "recorder", facilityId: "facility-a", sessionId: "session" };
const request = () => new Request("http://localhost/", { method: "POST", body: JSON.stringify({ measuredAt: "2026-01-01T00:00:00Z", values: { temperatureC: 37 } }) });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(user as any); vi.mocked(db.visit.findFirst).mockResolvedValue({ id } as any); vi.mocked(db.measuredVitals.findMany).mockResolvedValue([]); });
it("scopes reads and withholds data if disclosure audit fails", async () => {
  const response = await GET(new Request("http://localhost/"), context);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(db.visit.findFirst).toHaveBeenCalledWith({ where: { id, facilityId: user.facilityId }, select: { id: true } });
  vi.mocked(recordDisclosure).mockRejectedValue(new Error("Audit unavailable"));
  expect((await GET(new Request("http://localhost/"), context)).status).toBe(500);
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
