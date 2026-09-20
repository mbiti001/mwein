import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  patient: { findMany: vi.fn(), findFirst: vi.fn() },
  visit: { findMany: vi.fn() },
  patientProblem: { findMany: vi.fn() },
  appointment: { findMany: vi.fn() },
  referral: { findMany: vi.fn() },
  laboratoryResult: { findFirst: vi.fn() },
  imagingResult: { findFirst: vi.fn() },
} }));

import { requirePermission } from "@/lib/auth";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { db } from "@/lib/db";
import { GET as patients } from "./patients/route";
import { GET as history } from "./patients/[id]/history/route";
import { GET as summaries } from "./visit-summaries/route";
import { GET as results } from "./clinical-results/[kind]/[id]/route";
import { GET as visits } from "./visits/route";

const id = "11111111-1111-4111-8111-111111111111";
const actor = { id: "actor", facilityId: "facility", sessionId: "session", permissions: ["patient.read", "encounter.write"] };
const request = new Request("http://localhost/api/patients?q=Private-name");
const cases = [
  { label: "patient search", run: () => patients(request), context: "PATIENT_SEARCH", type: "Patient" },
  { label: "patient history", run: () => history(request, { params: Promise.resolve({ id }) }), context: "PATIENT_HISTORY", type: "Patient" },
  { label: "visit summary", run: () => summaries(request), context: "VISIT_SUMMARIES", type: "Visit" },
  { label: "visit worklist", run: () => visits(), context: "VISIT_WORKLIST", type: "Visit" },
  { label: "laboratory result", run: () => results(request, { params: Promise.resolve({ id, kind: "laboratory" }) }), context: "CLINICAL_RESULT", type: "LaboratoryResult" },
  { label: "imaging result", run: () => results(request, { params: Promise.resolve({ id, kind: "imaging" }) }), context: "CLINICAL_RESULT", type: "ImagingResult" },
];

describe("clinical API disclosure boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue(actor as any);
    vi.mocked(db.patient.findMany).mockResolvedValue([{ id, fullName: "Private-name" }] as any);
    vi.mocked(db.patient.findFirst).mockResolvedValue({ id, fullName: "Private-name" } as any);
    vi.mocked(db.visit.findMany).mockResolvedValue([{ id, encounters: [], arrivedAt: new Date(), priority: "ROUTINE", status: "REGISTERED" }] as any);
    vi.mocked(db.patientProblem.findMany).mockResolvedValue([]);
    vi.mocked(db.appointment.findMany).mockResolvedValue([]);
    vi.mocked(db.referral.findMany).mockResolvedValue([]);
    vi.mocked(db.laboratoryResult.findFirst).mockResolvedValue({ id } as any);
    vi.mocked(db.imagingResult.findFirst).mockResolvedValue({ id } as any);
  });

  it.each(cases)("audits $label before returning uncached data", async ({ run, context, type }) => {
    const response = await run();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(recordClinicalAccess).toHaveBeenCalledWith(actor, context, [{ type, id }]);
  });

  it.each(cases)("withholds $label if audit retention fails", async ({ run }) => {
    vi.mocked(recordClinicalAccess).mockRejectedValue(new Error("Audit unavailable"));
    const response = await run();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Private-name");
  });

  it.each(cases)("does not record an authorised disclosure for denied $label", async ({ run }) => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Permission denied"), { status: 403 }));
    expect((await run()).status).toBe(403);
    expect(recordClinicalAccess).not.toHaveBeenCalled();
    expect(db.patient.findMany).not.toHaveBeenCalled();
    expect(db.visit.findMany).not.toHaveBeenCalled();
  });

  it("does not audit a nonexistent or other-facility patient as disclosed", async () => {
    vi.mocked(db.patient.findFirst).mockResolvedValue(null);
    expect((await history(request, { params: Promise.resolve({ id }) })).status).toBe(404);
    expect(db.patient.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: actor.facilityId } }));
    expect(recordClinicalAccess).not.toHaveBeenCalled();
  });
});
