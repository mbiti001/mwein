import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn(), visit: { findFirst: vi.fn() }, patientRelationship: { findMany: vi.fn() } } }));
import { requirePermission } from "./auth";
import { appendAudit } from "./audit";
import { recordDisclosure } from "./disclosure-audit";
import { db } from "./db";
import { GET, POST } from "@/app/api/service-points/route";

const visitId = "11111111-1111-4111-8111-111111111111";
const patientId = "22222222-2222-4222-8222-222222222222";
const relatedPatientId = "33333333-3333-4333-8333-333333333333";
const user = { id: "actor", facilityId: "facility-a", sessionId: "session-a", facility: { timezone: "Africa/Nairobi" } };
const data = { serviceRequested: "Screening", requestDetails: "Synthetic request", safetyScreen: "Synthetic checks", carePlan: "Synthetic follow-up" };
const input = { action: "SAVE_ASSESSMENT", visitId, servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", data, riskLevel: "ROUTINE" };
const link = { action: "LINK_PATIENT", visitId, relatedPatientId, relationship: "MOTHER_OF" };
let visit: any;
let saved: any;
let committed: any[];
let staged: any[];
const tx = {
  visit: { findFirst: vi.fn(), update: vi.fn() },
  encounter: { create: vi.fn() },
  servicePointRecord: { upsert: vi.fn() },
  patient: { findFirst: vi.fn() },
  patientRelationship: { upsert: vi.fn() },
  queueEntry: { updateMany: vi.fn() },
};
const post = (body: unknown = input) => POST(new Request("http://localhost/api/service-points", { method: "POST", body: JSON.stringify(body) }));
const get = () => GET(new Request(`http://localhost/api/service-points?visitId=${visitId}`));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(user as any);
  visit = { id: visitId, patientId, clinic: "Walk-in", status: "AWAITING_CLINICIAN", clinicallyClosedAt: null, patient: { id: patientId }, encounters: [{ id: "encounter", status: "DRAFT" }] };
  saved = null; committed = []; staged = [];
  tx.visit.findFirst.mockImplementation(async () => visit);
  tx.patient.findFirst.mockResolvedValue({ id: relatedPatientId, fullName: "Synthetic relation" });
  tx.encounter.create.mockResolvedValue({ id: "new-encounter", status: "DRAFT" });
  tx.patientRelationship.upsert.mockResolvedValue({ id: "relationship" });
  tx.servicePointRecord.upsert.mockImplementation(async (args) => {
    const record = { id: "record", ...args.update, updatedAt: new Date("2026-10-19T20:00:00Z") };
    staged.push(record);
    return record;
  });
  // A model of transaction commit, NOT native PostgreSQL rollback/concurrency evidence.
  vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
    staged = [];
    const result = await callback(tx);
    committed.push(...staged);
    if (staged.length) saved = staged.at(-1);
    return result;
  });
  vi.mocked(db.visit.findFirst).mockImplementation((async (args: any) => visit && ({ ...visit, encounters: visit.encounters.filter((e: any) => args.select.encounters.where.status.in.includes(e.status)).slice(0, 1).map((e: any) => ({ ...e, servicePointRecord: saved })) })) as any);
  vi.mocked(db.patientRelationship.findMany).mockResolvedValue([]);
});

describe("service assessment existing safety boundaries", () => {
  it.each([401, 403])("denies writes with auth status %s before any transaction", async status => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status }));
    expect((await post()).status).toBe(status);
    expect(requirePermission).toHaveBeenCalledWith("encounter.write");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each([input, link])("scopes $action to the authenticated facility before writing", async body => {
    visit = null;
    expect((await post(body)).status).toBe(404);
    expect(tx.visit.findFirst.mock.calls[0][0].where).toEqual({ id: visitId, facilityId: "facility-a" });
    expect(tx.servicePointRecord.upsert).not.toHaveBeenCalled();
    expect(tx.patientRelationship.upsert).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });
  it.each(["COMPLETED", "CANCELLED"])("blocks both actions for %s visits", async status => {
    visit.status = status;
    for (const body of [input, link]) expect((await post(body)).status).toBe(409);
    expect(committed).toEqual([]);
    expect(tx.patientRelationship.upsert).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });
  it("blocks signed assessment replacement before upsert", async () => {
    visit.encounters = [{ id: "signed", status: "SIGNED" }];
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("addendum");
    expect(tx.encounter.create).not.toHaveBeenCalled();
    expect(tx.servicePointRecord.upsert).not.toHaveBeenCalled();
  });
  it.each([
    { label: "wrong clinic", changeVisit: true, patch: {}, status: 422 },
    { label: "old template", patch: { templateVersion: "OLD-1.0" }, status: 409 },
    { label: "unknown field", patch: { data: { ...data, unreviewed: "value" } }, status: 422 },
    { label: "missing required field", patch: { data: { ...data, safetyScreen: "" } }, status: 422 },
    { label: "unsupported action", patch: { action: "CORRECT_ASSESSMENT" }, status: 422 },
    { label: "invalid visit ID", patch: { visitId: "not-uuid" }, status: 422 },
  ])("rejects $label without saving or auditing", async ({ changeVisit, patch, status }) => {
    if (changeVisit) visit.clinic = "ANC";
    expect((await post({ ...input, ...patch })).status).toBe(status);
    expect(tx.servicePointRecord.upsert).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });
  it("uses one Serializable transaction and stamps the authenticated updater", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.$transaction).mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
    expect(saved.updatedById).toBe(user.id);
    expect(tx.visit.update).toHaveBeenCalledWith({ where: { id: visitId }, data: { status: "UNDER_CONSULTATION" } });
    expect(tx.queueEntry.updateMany.mock.calls[0][0].where).toMatchObject({ visitId, servicePoint: "CONSULTATION", status: { in: ["WAITING", "CALLED"] } });
    expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: user.id, action: "SERVICE_POINT_ASSESSMENT_SAVED", entityId: "record" }));
  });
  it.each([
    { code: "P2034" }, { code: "P2010", meta: { code: "40001" } }, { code: "P2010", meta: { code: "40P01" } },
  ])("does not silently retry an aborted assessment transaction: %j", async failure => {
    vi.mocked(appendAudit).mockRejectedValue(failure);
    expect((await post()).status).toBe(409);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([]);
  });
  it("withholds success on audit failure without a modeled commit", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("Synthetic audit failure"));
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("record");
    expect(committed).toEqual([]);
    expect(saved).toBeNull();
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it("rejects self links and unavailable/foreign/inactive related patients", async () => {
    expect((await post({ ...link, relatedPatientId: patientId })).status).toBe(422);
    tx.patient.findFirst.mockResolvedValue(null);
    expect((await post(link)).status).toBe(404);
    expect(tx.patient.findFirst.mock.calls[0][0].where).toEqual({ id: relatedPatientId, facilityId: "facility-a", active: true });
    expect(tx.patientRelationship.upsert).not.toHaveBeenCalled();
  });
  it("links an existing patient without changing assessment data", async () => {
    expect((await post(link)).status).toBe(200);
    expect(tx.patientRelationship.upsert.mock.calls[0][0].create.createdById).toBe(user.id);
    expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "PATIENT_RELATIONSHIP_LINKED", userId: user.id }));
    expect(tx.servicePointRecord.upsert).not.toHaveBeenCalled();
  });
  it("scopes reads and records disclosure before private output", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(vi.mocked(db.visit.findFirst).mock.calls[0][0]?.where).toEqual({ id: visitId, facilityId: user.facilityId });
    expect(recordDisclosure).toHaveBeenCalledWith(user, "SERVICE_POINTS", [visitId]);
  });
  it("withholds record output if disclosure auditing fails", async () => {
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("Synthetic disclosure failure"));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("record");
  });
});

// Explicit baseline observations, NOT desired behavior. Replace these assertions with
// rejection/retention requirements when implementing SERVICE-ASSESSMENT-AUDIT.md.
describe("known assessment gaps — characterization of unmodified runtime", () => {
  it.each([
    { status: "DISCHARGED", clinicallyClosedAt: null },
    { status: "UNDER_CONSULTATION", clinicallyClosedAt: new Date("2026-10-19T19:00:00Z") },
  ])("currently accepts both writes after closure: %j", async state => {
    Object.assign(visit, state);
    expect((await post()).status).toBe(200);
    expect((await post(link)).status).toBe(200);
    expect(committed).toHaveLength(1);
    expect(tx.patientRelationship.upsert).toHaveBeenCalledTimes(1);
  });
  it("currently creates a new draft beside a corrected encounter", async () => {
    visit.encounters = [{ id: "corrected", status: "CORRECTED" }];
    expect((await post()).status).toBe(200);
    expect(tx.encounter.create).toHaveBeenCalledTimes(1);
    expect(tx.servicePointRecord.upsert.mock.calls[0][0].where).toEqual({ encounterId: "new-encounter" });
  });
  it("currently omits corrected assessment records from GET", async () => {
    saved = { id: "retained-record", data };
    visit.encounters = [{ id: "corrected", status: "CORRECTED" }];
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ record: null, encounterStatus: null });
  });
  it("currently accepts a stale sequential save and discards an unrecognized revision", async () => {
    expect((await post({ ...input, data: { ...data, carePlan: "Newer plan" } })).status).toBe(200);
    expect((await post({ ...input, expectedRevision: "stale-client-value" })).status).toBe(200);
    expect(saved.data.carePlan).toBe(data.carePlan);
    expect(committed.map(record => record.data.carePlan)).toEqual(["Newer plan", data.carePlan]);
    expect(tx.servicePointRecord.upsert.mock.calls[1][0].where).toEqual({ encounterId: "encounter" });
  });
  it("currently emits identical audit payload fingerprints for different values and no session", async () => {
    await post();
    await post({ ...input, riskLevel: "HIGH", data: { ...data, carePlan: "Different synthetic plan" } });
    const events = vi.mocked(appendAudit).mock.calls.map(call => call[1]);
    expect(events).toHaveLength(2);
    expect(events[0].afterHash).toBe(events[1].afterHash);
    expect(events[0]).not.toHaveProperty("sessionId");
    expect(events[0]).not.toHaveProperty("beforeHash");
    // This does not claim equal audit event hashes: appendAudit also hashes identity/time/chain metadata.
  });
});
