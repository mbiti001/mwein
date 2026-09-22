import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn(), auditValueFingerprint: vi.fn().mockReturnValue("hash") }));
vi.mock("@/lib/db", () => ({ db: { surveillanceRecord: { findMany: vi.fn(), findFirst: vi.fn() }, $transaction: vi.fn() } }));
import { requirePermission } from "@/lib/auth";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { GET, POST, PATCH } from "./route";
const user = { id: "actor", facilityId: "facility-a", sessionId: "session" };
const id = "11111111-1111-4111-8111-111111111111";
const details = { kind: "CASE", patientId: null, concern: "Synthetic", description: "Synthetic case", location: "", detectedAt: "2026-01-01T00:00:00Z", onsetAt: null, priority: "URGENT" };
const req = (method: string, body: unknown) => new Request("http://localhost/api/surveillance", { method, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requirePermission).mockResolvedValue(user as any); vi.mocked(recordDisclosure).mockResolvedValue(); vi.mocked(db.surveillanceRecord.findMany).mockResolvedValue([]); });
describe("surveillance facility and disclosure boundaries", () => {
  it("scopes and audits list access with private responses", async () => {
    const response = await GET(new Request("http://localhost/api/surveillance?priority=URGENT"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(db.surveillanceRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId: user.facilityId, status: "OPEN", priority: "URGENT" } }));
    expect(recordDisclosure).toHaveBeenCalledWith(user, "SURVEILLANCE", [], expect.objectContaining({ transport: "DISABLED" }));
  });
  it("does not disclose when audit storage fails", async () => {
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("Audit unavailable"));
    const response = await GET(new Request("http://localhost/api/surveillance"));
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("records");
  });
  it("denies unauthorized requests before database access", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    for (const handler of [GET, POST, PATCH]) expect((await handler(new Request("http://localhost/api/surveillance"))).status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.surveillanceRecord.findMany).not.toHaveBeenCalled();
  });
  it("returns not found for a foreign record on detail and mutation", async () => {
    vi.mocked(db.surveillanceRecord.findFirst).mockResolvedValue(null);
    expect((await GET(new Request(`http://localhost/api/surveillance?id=${id}`))).status).toBe(404);
    const findFirst = vi.fn().mockResolvedValue(null);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ surveillanceRecord: { findFirst } }));
    expect((await PATCH(req("PATCH", { id, version: 1, action: "REVIEW", reason: "Reviewed" }))).status).toBe(404);
    expect(findFirst).toHaveBeenCalledWith({ where: { id, facilityId: user.facilityId } });
  });
  it("rejects cross-facility patient links before creating a case", async () => {
    const patient = { findFirst: vi.fn().mockResolvedValue(null) }, create = vi.fn();
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ patient, surveillanceRecord: { create } }));
    expect((await POST(req("POST", { details: { ...details, patientId: id } }))).status).toBe(404);
    expect(patient.findFirst).toHaveBeenCalledWith({ where: { id, facilityId: user.facilityId }, select: { id: true } });
    expect(create).not.toHaveBeenCalled(); expect(appendAudit).not.toHaveBeenCalled();
  });
  it("rejects stale updates and a foreign duplicate target without mutation", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({ id, version: 2 }).mockResolvedValueOnce({ id, version: 1, status: "OPEN", priority: "URGENT" }).mockResolvedValueOnce(null);
    const updateMany = vi.fn();
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ surveillanceRecord: { findFirst, updateMany } }));
    expect((await PATCH(req("PATCH", { id, version: 1, action: "REVIEW", reason: "Reviewed" }))).status).toBe(409);
    expect((await PATCH(req("PATCH", { id, version: 1, action: "DUPLICATE", duplicateOfId: "22222222-2222-4222-8222-222222222222", reason: "Duplicate" }))).status).toBe(422);
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("rejects acknowledgements for another record or before notification", async () => {
    const record = { id, version: 1, status: "OPEN", priority: "URGENT" };
    const entry = { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ action: "NOTIFY", evidence: { notifiedAt: "2026-01-02T00:00:00Z", recipient: "County office", channel: "PHONE", outcome: "ATTEMPTED", evidenceReference: "Call record", assurance: "STAFF_RECORDED_ONLY" } }) };
    const updateMany = vi.fn();
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ surveillanceRecord: { findFirst: vi.fn().mockResolvedValue(record), updateMany }, surveillanceEntry: entry }));
    const body = { id, version: 1, action: "ACKNOWLEDGE", reason: "Follow up", acknowledgement: { notificationId: id, acknowledgedAt: "2026-01-01T00:00:00Z", recipient: "County office", evidenceReference: "Test receipt" } };
    expect((await PATCH(req("PATCH", body))).status).toBe(404);
    expect((await PATCH(req("PATCH", body))).status).toBe(422);
    expect(entry.findFirst).toHaveBeenCalledWith({ where: { id, recordId: id } }); expect(updateMany).not.toHaveBeenCalled();
  });
});
