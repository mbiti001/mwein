import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  patient: { findFirst: vi.fn() }, visit: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  appointment: { findFirst: vi.fn(), update: vi.fn() }, catalogItem: { findUnique: vi.fn() },
  facility: { findUniqueOrThrow: vi.fn() }, referenceSequence: { upsert: vi.fn() }, $transaction: vi.fn(),
} }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { POST } from "./route";
const actor = { id: "staff-a", facilityId: "facility-a", sessionId: "session-a" };
const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", patientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const details = { patientId, clinic: "Emergency", priority: "EMERGENCY", visitType: "EMERGENCY" };
const fingerprint = createHash("sha256").update(JSON.stringify([actor.facilityId, actor.id, details])).digest("hex");
const visit = { id: "visit-a", visitNumber: "V-1", clinic: "Emergency", status: "AWAITING_TRIAGE", clinicallyClosedAt: null };
const post = (body: object = { idempotencyKey: key, ...details }) => POST(new Request("http://localhost/api/visits", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(actor as never);
  vi.mocked(db.$transaction).mockImplementation(async (operation: any) => operation(db));
  vi.mocked(db.visit.findUnique).mockResolvedValue(null); vi.mocked(db.visit.findFirst).mockResolvedValue(null);
  vi.mocked(db.patient.findFirst).mockResolvedValue({ id: patientId } as never);
  vi.mocked(db.catalogItem.findUnique).mockResolvedValue(null);
  vi.mocked(db.facility.findUniqueOrThrow).mockResolvedValue({ code: "MMS" } as never);
  vi.mocked(db.referenceSequence.upsert).mockResolvedValue({ nextValue: 2n } as never);
  vi.mocked(db.visit.create).mockResolvedValue({ ...visit, checkInKey: key, checkInFingerprint: fingerprint } as never);
});
describe("atomic check-in", () => {
  it("checks duplicate care inside the serializable creation transaction and retains replay identity", async () => {
    const response = await post();
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(db.patient.findFirst).toHaveBeenCalledWith({ where: { id: patientId, facilityId: actor.facilityId, active: true } });
    expect(db.visit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId: actor.facilityId, patientId, clinicallyClosedAt: null, status: { notIn: ["COMPLETED", "CANCELLED", "DISCHARGED"] } } }));
    expect(db.visit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ checkInKey: key, checkInFingerprint: fingerprint }) }));
    expect(await response.json()).toEqual({ visit });
    expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: "VISIT_CREATED", sessionId: actor.sessionId }));
  });
  it("returns an audited existing visit without creating another invoice or task", async () => {
    vi.mocked(db.visit.findFirst).mockResolvedValue(visit as never);
    const response = await post();
    expect(response.status).toBe(409); expect((await response.json()).details.activeVisit.id).toBe(visit.id);
    expect(db.visit.create).not.toHaveBeenCalled(); expect(db.referenceSequence.upsert).not.toHaveBeenCalled();
    expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: "ACTIVE_VISIT_IDENTIFIED", entityId: visit.id }));
  });
  it("replays the same staff request even after closure without reopening care", async () => {
    vi.mocked(db.visit.findUnique).mockResolvedValue({ ...visit, status: "CANCELLED", checkInFingerprint: fingerprint } as never);
    const response = await post();
    expect(response.status).toBe(200); expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await response.json()).visit).toEqual({ ...visit, status: "CANCELLED" });
    expect(db.visit.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId_checkInKey: { facilityId: actor.facilityId, checkInKey: key } } }));
    expect(db.patient.findFirst).not.toHaveBeenCalled(); expect(db.visit.create).not.toHaveBeenCalled();
    expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: "VISIT_CHECK_IN_REPLAYED" }));
  });
  it.each([{ ...details, clinic: "Outpatient" }, { ...details, priority: "ROUTINE" }])("rejects changed routing under the same replay key: %j", async changed => {
    vi.mocked(db.visit.findUnique).mockResolvedValue({ ...visit, checkInFingerprint: fingerprint } as never);
    expect((await post({ idempotencyKey: key, ...changed })).status).toBe(409); expect(db.visit.create).not.toHaveBeenCalled();
  });
  it("does not disclose another staff member's replay", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ...actor, id: "staff-b" } as never);
    vi.mocked(db.visit.findUnique).mockResolvedValue({ ...visit, checkInFingerprint: fingerprint } as never);
    const response = await post(); expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty("visit");
  });
  it("denies foreign or inactive patients before creating care", async () => {
    vi.mocked(db.patient.findFirst).mockResolvedValue(null);
    expect((await post()).status).toBe(404); expect(db.visit.create).not.toHaveBeenCalled();
  });
  it("requires current permission even for a retained replay", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    expect((await post()).status).toBe(403); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("retries the whole failed transaction, then finds the saved visit", async () => {
    vi.mocked(db.$transaction).mockRejectedValueOnce({ code: "P2034" });
    vi.mocked(db.visit.findUnique).mockResolvedValue({ ...visit, checkInFingerprint: fingerprint } as never);
    expect((await post()).status).toBe(200); expect(db.$transaction).toHaveBeenCalledTimes(2); expect(db.visit.create).not.toHaveBeenCalled();
  });
  it("bounds retries under sustained contention", async () => {
    vi.mocked(db.$transaction).mockRejectedValue({ code: "P2034" });
    expect((await post()).status).toBe(409); expect(db.$transaction).toHaveBeenCalledTimes(3);
  });
  it("does not return replay information when its audit fails", async () => {
    vi.mocked(db.visit.findUnique).mockResolvedValue({ ...visit, checkInFingerprint: fingerprint } as never);
    vi.mocked(appendAudit).mockRejectedValue(new Error("Audit unavailable"));
    expect((await post()).status).toBe(500);
  });
  it("rejects an invalid request key before accessing records", async () => {
    expect((await post({ ...details, idempotencyKey: "invalid" })).status).toBe(422);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
