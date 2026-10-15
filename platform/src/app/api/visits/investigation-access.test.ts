import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  visit: { findFirst: vi.fn(), findMany: vi.fn() }, patient: { findFirst: vi.fn() },
  patientProblem: { findMany: vi.fn() }, appointment: { findMany: vi.fn() }, referral: { findMany: vi.fn() },
} }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { GET as investigations } from "./[id]/investigations/route";
import { GET as worklist } from "./route";
import { GET as history } from "../patients/[id]/history/route";
import { GET as summaries } from "../visit-summaries/route";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = { id: "clinician", facilityId: "facility-a", sessionId: "session-a", permissions: ["encounter.write"] };
const context = { params: Promise.resolve({ id }) };
const request = new Request(`http://localhost/api/visits/${id}/investigations`);
const released = { status: "VERIFIED", verifiedAt: { not: null } };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(actor as never);
  vi.mocked(db.visit.findFirst).mockResolvedValue({ id, orders: [] } as never);
  vi.mocked(db.patient.findFirst).mockResolvedValue({ id } as never);
  for (const model of [db.visit, db.patientProblem, db.appointment, db.referral]) vi.mocked(model.findMany).mockResolvedValue([]);
});
describe("clinical investigation release boundary", () => {
  it("uses facility authorization and verified timestamps for both report types", async () => {
    const response = await investigations(request, context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requirePermission).toHaveBeenCalledWith("clinical.results.read");
    const query = vi.mocked(db.visit.findFirst).mock.calls[0][0] as any;
    expect(query.where).toEqual({ id, facilityId: actor.facilityId });
    expect(query.select.orders.select.laboratory.select.result.where).toEqual(released);
    expect(query.select.orders.select.imaging.select.result.where).toEqual(released);
    expect(recordClinicalAccess).toHaveBeenCalledWith(actor, "VISIT_INVESTIGATIONS", [{ type: "Visit", id }]);
  });
  it("denies unauthorized readers before querying", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    expect((await investigations(request, context)).status).toBe(403);
    expect(db.visit.findFirst).not.toHaveBeenCalled(); expect(recordClinicalAccess).not.toHaveBeenCalled();
  });
  it("does not disclose a missing or other-facility visit", async () => {
    vi.mocked(db.visit.findFirst).mockResolvedValue(null);
    expect((await investigations(request, context)).status).toBe(404);
    expect(recordClinicalAccess).not.toHaveBeenCalled();
  });
  it("rejects malformed identifiers before reading", async () => {
    expect((await investigations(request, { params: Promise.resolve({ id: "invalid" }) })).status).toBe(422);
    expect(db.visit.findFirst).not.toHaveBeenCalled();
  });
  it("keeps closed visits readable, bounds the response and audits only disclosed report IDs", async () => {
    const orders = Array.from({ length: 201 }, (_, index) => ({ id: String(index), laboratory: { result: { id: `lab-${index}` } }, imaging: null }));
    vi.mocked(db.visit.findFirst).mockResolvedValue({ id, status: "DISCHARGED", clinicallyClosedAt: new Date(), orders } as never);
    const response = await investigations(request, context); const body = await response.json();
    expect(body.visit.status).toBe("DISCHARGED"); expect(body.visit.orders).toHaveLength(200); expect(body.truncated).toBe(true);
    expect(vi.mocked(db.visit.findFirst).mock.calls[0][0]?.select?.orders).toMatchObject({ take: 201 });
    const resources = vi.mocked(recordClinicalAccess).mock.calls[0][2];
    expect(resources).toHaveLength(201); expect(resources).not.toContainEqual({ type: "LaboratoryResult", id: "lab-200" });
  });
  it("fails closed if the disclosure audit cannot be written", async () => {
    vi.mocked(db.visit.findFirst).mockResolvedValue({ id, patient: { fullName: "Never disclose this" }, orders: [] } as never);
    vi.mocked(recordClinicalAccess).mockRejectedValue(new Error("audit unavailable"));
    const response = await investigations(request, context);
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("Never disclose this");
  });
  it("applies the same release boundary to patient history and summaries", async () => {
    expect((await history(request, context)).status).toBe(200);
    let query = vi.mocked(db.visit.findMany).mock.calls[0][0] as any;
    expect(query.where.facilityId).toBe(actor.facilityId);
    expect(query.select.orders.select.laboratory.select.result.where).toEqual(released);
    expect(query.select.orders.select.imaging.select.result.where).toEqual(released);
    vi.mocked(db.visit.findMany).mockClear();
    expect((await summaries(new Request("http://localhost/api/visit-summaries"))).status).toBe(200);
    query = vi.mocked(db.visit.findMany).mock.calls[0][0] as any;
    expect(query.include.orders.include.laboratory.include.result.where).toEqual(released);
    expect(query.include.orders.include.imaging.include.result.where).toEqual(released);
  });
  it.each([
    [["encounter.write"], true, true],
    [["encounter.write", "laboratory.write"], false, true],
    [["encounter.write", "imaging.write"], true, false],
  ])("allows workbench drafts only with the corresponding write grant: %j", async (permissions, filterLab, filterImaging) => {
    vi.mocked(requirePermission).mockResolvedValue({ ...actor, permissions } as never);
    expect((await worklist()).status).toBe(200);
    const query = vi.mocked(db.visit.findMany).mock.calls[0][0] as any;
    expect(query.select.orders.include.laboratory.include.result.where).toEqual(filterLab ? released : undefined);
    expect(query.select.orders.include.imaging.include.result.where).toEqual(filterImaging ? released : undefined);
  });
});
