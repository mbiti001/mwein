import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  patient: { findFirst: vi.fn() }, visit: { findFirst: vi.fn(), findMany: vi.fn() },
  patientProblem: { findMany: vi.fn() }, appointment: { findMany: vi.fn() }, referral: { findMany: vi.fn() },
} }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { GET as history } from "./patients/[id]/history/route";
import { GET as summaries } from "./visit-summaries/route";
import { GET as investigations } from "./visits/[id]/investigations/route";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const excluded = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor = { id: "reader", facilityId: "facility-a", sessionId: "reader-session" };
const context = { params: Promise.resolve({ id }) };
const routes = [
  { name: "history", permission: "clinical.history.read", run: () => history(new Request(`http://localhost/api/patients/${id}/history?exclude=${excluded}`), context) },
  { name: "summaries", permission: "clinical.summary.read", run: () => summaries(new Request(`http://localhost/api/visit-summaries?visitId=${id}`)) },
  { name: "investigations", permission: "clinical.results.read", run: () => investigations(new Request(`http://localhost/api/visits/${id}/investigations`), context) },
];
const reads = [db.patient.findFirst, db.visit.findFirst, db.visit.findMany, db.patientProblem.findMany, db.appointment.findMany, db.referral.findMany];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(actor as never);
  vi.mocked(db.patient.findFirst).mockResolvedValue({ id, fullName: "Private patient sentinel" } as never);
  vi.mocked(db.visit.findFirst).mockResolvedValue({ id, patient: { fullName: "Private patient sentinel" }, orders: [] } as never);
  for (const read of [db.visit.findMany, db.patientProblem.findMany, db.appointment.findMany, db.referral.findMany]) vi.mocked(read).mockResolvedValue([]);
});

describe("clinical reader audit boundaries", () => {
  for (const route of routes) {
    it.each([401, 403])(`${route.name} denies %s before any domain read or disclosure`, async status => {
      vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Access denied"), { status }));
      const response = await route.run();
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(requirePermission).toHaveBeenCalledWith(route.permission);
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      expect(recordClinicalAccess).not.toHaveBeenCalled();
    });
    it(`${route.name} withholds the response when disclosure audit fails`, async () => {
      vi.mocked(db.visit.findMany).mockResolvedValue([{ id, patient: { fullName: "Private patient sentinel" }, encounters: [] }] as never);
      // History needs its timeline fields; summaries deliberately retain an identifiable populated row.
      if (route.name === "history") vi.mocked(db.visit.findMany).mockResolvedValue([]);
      vi.mocked(recordClinicalAccess).mockRejectedValue(new Error("Private database error sentinel"));
      const response = await route.run();
      expect(recordClinicalAccess).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.text();
      expect(body).not.toContain("Private patient sentinel");
      expect(body).not.toContain("Private database error sentinel");
    });
    it(`${route.name} awaits audit completion before returning success`, async () => {
      let release!: () => void;
      let entered!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      vi.mocked(recordClinicalAccess).mockImplementation(async () => { entered(); await barrier; });
      let returned = false;
      const response = route.run().then(value => { returned = true; return value; });
      await started;
      expect(returned).toBe(false);
      release();
      expect((await response).status).toBe(200);
    });
  }

  it("history scopes every independent read and exclusion to the actor's facility and patient", async () => {
    expect((await routes[0].run()).status).toBe(200);
    expect(db.patient.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: actor.facilityId } }));
    expect(db.visit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { patientId: id, facilityId: actor.facilityId, id: { not: excluded } }, take: 20 }));
    for (const model of [db.patientProblem, db.appointment, db.referral]) {
      expect(model.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { patientId: id, facilityId: actor.facilityId } }));
    }
    expect(recordClinicalAccess).toHaveBeenCalledWith(actor, "PATIENT_HISTORY", [{ type: "Patient", id }]);
  });
  it("history refuses missing or foreign patients before any child reads", async () => {
    vi.mocked(db.patient.findFirst).mockResolvedValue(null);
    expect((await routes[0].run()).status).toBe(404);
    for (const read of reads.slice(1)) expect(read).not.toHaveBeenCalled();
    expect(recordClinicalAccess).not.toHaveBeenCalled();
  });
  it.each(["visit", "patientProblem", "appointment", "referral"] as const)("history does not return partial data if %s fails", async model => {
    vi.mocked(db[model].findMany).mockRejectedValue(new Error("Private database error sentinel"));
    const response = await routes[0].run();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("Private patient sentinel");
    expect(recordClinicalAccess).not.toHaveBeenCalled();
  });
  it("summary selects signed notes ahead of a newer draft and removes confidential content", async () => {
    vi.mocked(db.visit.findMany).mockResolvedValue([{
      id, encounters: [
        { id: "draft", status: "DRAFT", subjective: '{"chiefComplaint":"newer draft sentinel"}' },
        { id: "signed", status: "SIGNED", clinician: { displayName: "Original clinician" },
          subjective: '{"chiefComplaint":"Signed complaint"}', objective: "{malformed", plan: '{"plan":"Return for review","confidentialNote":"confidential sentinel"}',
          addenda: [{ id: "addendum", author: { displayName: "Addendum author" }, text: "Retained signed addendum" }] },
      ],
    }] as never);
    const response = await routes[1].run();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summaries[0].encounter).toMatchObject({ id: "signed", status: "SIGNED", clinician: { displayName: "Original clinician" }, objective: {}, plan: { plan: "Return for review" }, addenda: [{ author: { displayName: "Addendum author" } }] });
    expect(body.summaries[0]).not.toHaveProperty("encounters");
    expect(JSON.stringify(body)).not.toContain("confidential sentinel");
    expect(JSON.stringify(body)).not.toContain("newer draft sentinel");
    expect(recordClinicalAccess).toHaveBeenCalledWith(actor, "VISIT_SUMMARIES", [{ type: "Visit", id }]);
  });
  it("summary keeps the draft status explicit when there is no signed encounter", async () => {
    vi.mocked(db.visit.findMany).mockResolvedValue([{ id, encounters: [{ id: "draft", status: "DRAFT", plan: '{"confidentialNote":"private draft"}' }] }] as never);
    const body = await (await routes[1].run()).json();
    expect(body.summaries[0].encounter).toMatchObject({ id: "draft", status: "DRAFT", plan: {} });
    expect(JSON.stringify(body)).not.toContain("private draft");
  });
  it("summary rejects oversized searches before reading or auditing", async () => {
    expect((await summaries(new Request(`http://localhost/api/visit-summaries?q=${"x".repeat(121)}`))).status).toBe(422);
    expect(db.visit.findMany).not.toHaveBeenCalled(); expect(recordClinicalAccess).not.toHaveBeenCalled();
  });
  it("investigation audit includes both released report identities with the visit", async () => {
    vi.mocked(db.visit.findFirst).mockResolvedValue({ id, orders: [
      { laboratory: { result: { id: "lab-report" } }, imaging: null },
      { imaging: { result: { id: "image-report" } }, laboratory: null },
      { laboratory: { result: null }, imaging: null },
    ] } as never);
    expect((await routes[2].run()).status).toBe(200);
    expect(recordClinicalAccess).toHaveBeenCalledWith(actor, "VISIT_INVESTIGATIONS", [
      { type: "Visit", id }, { type: "LaboratoryResult", id: "lab-report" }, { type: "ImagingResult", id: "image-report" },
    ]);
  });
});
