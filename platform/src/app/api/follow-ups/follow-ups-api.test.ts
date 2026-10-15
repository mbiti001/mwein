import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { appointment: { findMany: vi.fn() }, referral: { findMany: vi.fn() }, servicePointRecord: { findMany: vi.fn() }, encounter: { findMany: vi.fn() } } }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { GET } from "./route";
const actor = { id: "staff", facilityId: "facility-a" };
const visit = { id: "visit", clinic: "Outpatient", visitNumber: "V-1", patient: { id: "patient", patientNumber: "P-1", fullName: "Synthetic Patient" } };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-15T07:00:00Z"));
  vi.mocked(requirePermission).mockResolvedValue(actor as never);
  for (const model of [db.appointment, db.referral, db.servicePointRecord, db.encounter]) vi.mocked(model.findMany).mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
describe("follow-up provenance and limits", () => {
  it("only reads signed, non-cancelled specialty and clinical plans from the actor's facility", async () => {
    const response = await GET();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requirePermission).toHaveBeenCalledWith("visit.read");
    expect(db.servicePointRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ encounter: { status: "SIGNED", visit: { facilityId: actor.facilityId, status: { not: "CANCELLED" } } } }) }));
    expect(db.encounter.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "SIGNED", visit: { facilityId: actor.facilityId, status: { not: "CANCELLED" } } }), take: 1001 }));
    expect(db.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facilityId: actor.facilityId, scheduledAt: { gte: new Date("2026-07-16T21:00:00Z"), lt: new Date() } }) }));
  });
  it("excludes invalid or beyond-horizon dates and links the original visit", async () => {
    vi.mocked(db.encounter.findMany).mockResolvedValue([
      { id: "invalid", plan: '{"followUpDate":"2026-02-30"}', visit },
      { id: "future", plan: '{"followUpDate":"2026-12-01"}', visit },
      { id: "today", plan: '{"followUpDate":"2026-10-15"}', visit },
      { id: "overdue", plan: '{"followUpDate":"2026-10-01"}', visit },
    ] as never);
    const body = await (await GET()).json();
    expect(body.worklists.clinical.map((item: { id: string }) => item.id)).toEqual(["overdue", "today"]);
    expect(body.worklists.clinical[0]).toMatchObject({ visitId: visit.id, visitNumber: visit.visitNumber, patient: visit.patient, followUpAt: "2026-10-01T00:00:00+03:00" });
    expect(recordDisclosure).toHaveBeenCalledWith(actor, "FOLLOW_UPS", ["overdue", "today"]);
  });
  it("reports truncation and audits only records actually disclosed", async () => {
    vi.mocked(db.appointment.findMany).mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ id: `a${i}` })) as never);
    vi.mocked(db.encounter.findMany).mockResolvedValue(Array.from({ length: 1001 }, (_, i) => ({ id: `e${i}`, plan: '{"followUpDate":"2026-10-15"}', visit })) as never);
    const body = await (await GET()).json();
    expect(body.worklists.appointments).toHaveLength(100); expect(body.worklists.clinical).toHaveLength(100);
    expect(body.truncated).toMatchObject({ appointments: true, clinical: true, clinicalScan: true });
    const ids = vi.mocked(recordDisclosure).mock.calls[0][2];
    expect(ids).toHaveLength(200); expect(ids).not.toContain("a100"); expect(ids).not.toContain("e1000");
  });
  it("does not disclose a successful response if recording the audit fails", async () => {
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("Audit unavailable"));
    expect((await GET()).status).toBe(500);
  });
});
