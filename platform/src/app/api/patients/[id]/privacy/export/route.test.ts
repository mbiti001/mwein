import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn(), auditValueFingerprint: vi.fn(() => "payload-hash") }));
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const user = { id: "dpo", sessionId: "session", facilityId: "facility", facility: { code: "MMS", name: "Synthetic facility" } };
const identityInput = { requestKey: "33333333-3333-4333-8333-333333333333", requesterKind: "PATIENT", requesterReference: "patient-ref", identityEvidenceReference: "identity-check-ref", authorizationScope: "PATIENT_RECORD_EXPORT", scopeSummary: "Entire synthetic patient record requested", attested: true };
const identityEvidence = { ...identityInput, version: 1, requestId: id, patientId: "patient", facilityId: user.facilityId, requestType: "ACCESS", verifiedAt: "2026-10-15T08:00:00.000Z", verifiedById: user.id, verifiedByName: "Synthetic DPO" };
const findFirst = vi.fn(), patient = vi.fn(), update = vi.fn(), lock = vi.fn();
const post = (extra: object = {}) => POST(new Request("http://localhost/api/patients/patient/privacy/export", { method: "POST", body: JSON.stringify({ requestId: id, ...extra }) }), { params: Promise.resolve({ id: "patient" }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(user as any);
  vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ $queryRaw: lock, dataSubjectRequest: { findFirst, update }, patient: { findFirst: patient } }));
  findFirst.mockResolvedValue({ id, patientId: "patient", facilityId: user.facilityId, identityVerification: identityEvidence, type: "ACCESS", status: "IN_REVIEW", responseEvidenceReference: null });
  patient.mockResolvedValue({ id: "patient" }); vi.mocked(appendAudit).mockResolvedValue({ id: "export-audit" } as any);
});
describe("export preparation is not delivery", () => {
  it("returns an audited private attachment while keeping completion fields untouched", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(update).toHaveBeenCalledWith({ where: { id }, data: { responsePreparedAt: expect.any(Date), responseEvidenceReference: "audit:export-audit", updatedById: user.id } });
    expect(lock.mock.calls[0].slice(1)).toEqual([id, "patient", user.facilityId]);
    expect(findFirst).toHaveBeenCalledWith({ where: { id, patientId: "patient", facilityId: user.facilityId } });
    expect(patient).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "patient", facilityId: user.facilityId } }));
  });
  it("requires the latest prepared reference and a retained reason to regenerate", async () => {
    findFirst.mockResolvedValue({ id, patientId:"patient",facilityId:user.facilityId,identityVerification:identityEvidence,type: "ACCESS", status: "IN_REVIEW", responseEvidenceReference: "audit:previous" });
    for (const extra of [{}, { previousResponseReference: "audit:previous" }, { previousResponseReference: "audit:stale", regenerationReason: "Download was lost earlier" }]) expect((await post(extra)).status).toBe(409);
    expect(patient).not.toHaveBeenCalled();
    expect((await post({ previousResponseReference: "audit:previous", regenerationReason: "Download was lost earlier" })).status).toBe(200);
    expect(appendAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ beforeHash: "audit:previous", reason: "Download was lost earlier", afterHash: "payload-hash" }));
  });
  it.each(["RECEIVED", "IDENTITY_VERIFIED", "COMPLETED", "DENIED", "CANCELLED"])("blocks export in %s", async status => {
    findFirst.mockResolvedValue({ id, type: "ACCESS", status });
    expect((await post()).status).toBe(409); expect(patient).not.toHaveBeenCalled();
  });
  it("checks permission before access and hides foreign request IDs", async () => {
    findFirst.mockResolvedValue(null); expect((await post()).status).toBe(404); expect(patient).not.toHaveBeenCalled();
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    lock.mockClear(); expect((await post()).status).toBe(403); expect(lock).not.toHaveBeenCalled();
  });
  it("withholds the attachment when auditing fails", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("audit unavailable"));
    const response = await post(); expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("patient"); expect(update).not.toHaveBeenCalled();
  });
});

it.each([null, {...identityEvidence, patientId: "another-patient"}, {...identityEvidence, facilityId: "another-facility"}, {...identityEvidence, authorizationScope: "REQUEST_REVIEW_ONLY"}])("blocks disclosure without scoped verified authority: %j",async identityVerification=>{
 findFirst.mockResolvedValue({id,patientId:"patient",facilityId:user.facilityId,type:"ACCESS",status:"IN_REVIEW",identityVerification});
 expect((await post()).status).toBe(409);expect(patient).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();
});
