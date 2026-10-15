import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { appointment: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() }, $transaction: vi.fn() } }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { appendAudit } from "@/lib/audit";
import { GET } from "./route";
import { PATCH } from "./[id]/status/route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = { id: "staff", facilityId: "facility-a", sessionId: "session" };
const context = { params: Promise.resolve({ id }) };
const patch = (body: object) => PATCH(new Request(`http://localhost/api/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify(body) }), context);
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-15T07:00:00Z"));
  vi.mocked(requirePermission).mockResolvedValue(actor as never);
  vi.mocked(db.appointment.findMany).mockResolvedValue([]);
  vi.mocked(db.appointment.findFirst).mockResolvedValue({ id, clinic: "Outpatient", status: "SCHEDULED", scheduledAt: new Date("2026-10-16T08:00:00Z") } as never);
  vi.mocked(db.appointment.update).mockResolvedValue({ id } as never);
  vi.mocked(db.$transaction).mockImplementation(async (operation: any) => operation(db));
});
afterEach(() => vi.useRealTimers());
describe("appointment worklist access", () => {
  it("defaults to the complete Nairobi day and scopes a focused patient to the facility", async () => {
    const response = await GET(new Request(`http://localhost/api/appointments?patientId=${id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(db.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId: actor.facilityId, patientId: id, scheduledAt: { gte: new Date("2026-10-14T21:00:00Z"), lt: new Date("2026-10-15T21:00:00Z") } } }));
    const options = vi.mocked(db.appointment.findMany).mock.calls[0][0] as any;
    expect(options.include.patient.select).not.toHaveProperty("allergies");
    expect(options.include.patient.select.consents.where).toMatchObject({ withdrawnAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] });
  });
  it("reports truncation and audits only records actually disclosed", async () => {
    vi.mocked(db.appointment.findMany).mockResolvedValue(Array.from({ length: 501 }, (_, n) => ({ id: String(n) })) as never);
    const response = await GET(new Request("http://localhost/api/appointments?scope=all"));
    const body = await response.json();
    expect(body.appointments).toHaveLength(500); expect(body.truncated).toBe(true);
    expect(vi.mocked(recordDisclosure).mock.calls[0][2]).toHaveLength(500);
  });
  it("rejects malformed filters before querying", async () => {
    expect((await GET(new Request("http://localhost/api/appointments?patientId=invalid"))).status).toBe(422);
    expect(db.appointment.findMany).not.toHaveBeenCalled();
  });
  it("withholds worklists when audit retention fails", async () => {
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("audit down"));
    const response = await GET(new Request("http://localhost/api/appointments"));
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("appointments");
  });
});
describe("appointment transitions", () => {
  it("rejects a future no-show without updating or auditing a mutation", async () => {
    expect((await patch({ status: "NO_SHOW" })).status).toBe(422);
    expect(db.appointment.update).not.toHaveBeenCalled(); expect(appendAudit).not.toHaveBeenCalled();
  });
  it("allows an elapsed appointment to be marked missed", async () => {
    vi.mocked(db.appointment.findFirst).mockResolvedValue({ id, status: "SCHEDULED", scheduledAt: new Date("2026-10-15T06:00:00Z") } as never);
    const response = await patch({ status: "NO_SHOW" });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: "APPOINTMENT_NO_SHOW", entityId: id }));
  });
  it("reads current status inside a serializable transaction and rejects checked-in appointments", async () => {
    vi.mocked(db.appointment.findFirst).mockResolvedValue({ id, status: "COMPLETED" } as never);
    expect((await patch({ status: "CANCELLED" })).status).toBe(409);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(db.appointment.findFirst).toHaveBeenCalledWith({ where: { id, facilityId: actor.facilityId } });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
  it("does not expose a foreign appointment", async () => {
    vi.mocked(db.appointment.findFirst).mockResolvedValue(null);
    expect((await patch({ status: "CANCELLED" })).status).toBe(404);
  });
  it("denies mutations before a transaction when permission is missing", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    expect((await patch({ status: "CANCELLED" })).status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("visit.create"); expect(db.$transaction).not.toHaveBeenCalled();
  });
});
