import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn(), visit: { findFirst: vi.fn() }, patientRelationship: { findMany: vi.fn() }, encounterAddendum: { findMany: vi.fn() } } }));
import { requirePermission } from "./auth";
import { appendAudit } from "./audit";
import { recordDisclosure } from "./disclosure-audit";
import { db } from "./db";
import { GET, POST } from "@/app/api/service-points/route";
import { assessmentRevision } from "./assessment-revision";
import { assessmentAuditFingerprint } from "./assessment-audit";

const visitId = "11111111-1111-4111-8111-111111111111";
const patientId = "22222222-2222-4222-8222-222222222222";
const relatedPatientId = "33333333-3333-4333-8333-333333333333";
const user = { id: "actor", facilityId: "facility-a", sessionId: "session-a", facility: { timezone: "Africa/Nairobi" } };
const data = { serviceRequested: "Screening", requestDetails: "Synthetic request", safetyScreen: "Synthetic checks", carePlan: "Synthetic follow-up" };
const originalEncounter = { id: "encounter", status: "DRAFT", updatedAt: new Date("2026-10-19T19:00:00Z"), servicePointRecord: null };
const input = { action: "SAVE_ASSESSMENT", visitId, expectedRevision: assessmentRevision(visitId, originalEncounter), servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", data, riskLevel: "ROUTINE" };
const link = { action: "LINK_PATIENT", visitId, relatedPatientId, relationship: "MOTHER_OF" };
let visit: any;
let saved: any;
let committed: any[];
let staged: any[];
const tx = {
  visit: { findFirst: vi.fn(), update: vi.fn() },
  encounter: { create: vi.fn(), update: vi.fn() },
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
  visit = { id: visitId, patientId, clinic: "Walk-in", status: "AWAITING_CLINICIAN", clinicallyClosedAt: null, patient: { id: patientId }, encounters: [{ ...originalEncounter }] };
  saved = null; committed = []; staged = [];
  tx.visit.findFirst.mockImplementation(async () => visit);
  tx.patient.findFirst.mockResolvedValue({ id: relatedPatientId, fullName: "Synthetic relation" });
  tx.encounter.create.mockImplementation(async () => ({ ...originalEncounter, id: "new-encounter" }));
  tx.encounter.update.mockImplementation(async args => ({ ...visit.encounters[0], ...args.data }));
  tx.patientRelationship.upsert.mockResolvedValue({ id: "relationship" });
  tx.servicePointRecord.upsert.mockImplementation(async (args) => {
    const record = { id: "record", encounterId: args.create.encounterId, ...args.update, updatedAt: new Date("2026-10-19T20:00:00Z") };
    staged.push(record);
    return record;
  });
  // A model of transaction commit, NOT native PostgreSQL rollback/concurrency evidence.
  vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
    staged = [];
    const result = await callback(tx);
    committed.push(...staged);
    if (staged.length) {
      saved = staged.at(-1);
      visit.encounters = [{ ...originalEncounter, ...(tx.encounter.update.mock.calls.at(-1)?.[0].data || {}), servicePointRecord: saved }];
    }
    return result;
  });
  vi.mocked(db.visit.findFirst).mockImplementation((async (args: any) => visit && ({ ...visit, _count: { encounters: visit.encounters.filter((e: any) => ["SIGNED", "CORRECTED"].includes(e.status)).length }, encounters: visit.encounters.filter((e: any) => args.select.encounters.where.status.in.includes(e.status)).slice(0, 1).map((e: any) => ({ ...e, servicePointRecord: saved })) })) as any);
  vi.mocked(db.patientRelationship.findMany).mockResolvedValue([]);
  vi.mocked(db.encounterAddendum.findMany).mockResolvedValue([]);
});

describe("assessment narrative history disclosure", () => {
  it("returns only the latest twenty visit addenda in deterministic order and audits their IDs", async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ id: `addendum-${i}`, encounterId: `encounter-${i}`, text: `Saved narrative ${i}`, reason: "Clarification", createdAt: new Date("2026-10-21T08:00:00Z"), author: { displayName: "Recorder" } }));
    vi.mocked(db.encounterAddendum.findMany).mockResolvedValue(items as any);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ addenda: { items: items.slice(0, 20).map(item => ({ ...item, createdAt: item.createdAt.toISOString() })), hasMore: true, limit: 20 } });
    expect(db.encounterAddendum.findMany).toHaveBeenCalledWith({
      where: { encounter: { visitId, visit: { facilityId: user.facilityId } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
      select: { id: true, encounterId: true, text: true, reason: true, createdAt: true, author: { select: { displayName: true } } },
    });
    expect(recordDisclosure).toHaveBeenCalledWith(user, "SERVICE_POINTS", [visitId, ...items.slice(0, 20).map(item => item.id)]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("distinguishes an empty audited result from an unavailable history", async () => {
    expect(await (await get()).json()).toMatchObject({ addenda: { items: [], hasMore: false, limit: 20 } });
    vi.mocked(db.encounterAddendum.findMany).mockRejectedValue(new Error("Synthetic read failure"));
    const failed = await get();
    expect(failed.status).toBe(500);
    expect(await failed.json()).not.toHaveProperty("addenda");
  });
  it.each([401, 403, 404])("does not query narratives after access denial %s", async status => {
    if (status === 404) visit = null;
    else vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status }));
    expect((await get()).status).toBe(status);
    expect(db.encounterAddendum.findMany).not.toHaveBeenCalled();
  });
  it("withholds narratives when disclosure auditing fails", async () => {
    vi.mocked(db.encounterAddendum.findMany).mockResolvedValue([{ id: "private", text: "Must not disclose" }] as any);
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("Synthetic disclosure failure"));
    const failed = await get();
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("Must not disclose");
  });
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
    expect(tx.visit.update).toHaveBeenCalledWith({ where: { id: visitId, updatedAt: undefined, status: "AWAITING_CLINICIAN", clinicallyClosedAt: null }, data: { status: "UNDER_CONSULTATION", updatedAt: expect.any(Date) } });
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

describe("assessment lifecycle, revision and audit corrections", () => {
  it.each([
    { status: "DISCHARGED", clinicallyClosedAt: null },
    { status: "UNDER_CONSULTATION", clinicallyClosedAt: new Date("2026-10-19T19:00:00Z") },
  ])("rejects both writes after closure: %j", async state => {
    Object.assign(visit, state);
    expect((await post()).status).toBe(409);
    expect((await post(link)).status).toBe(409);
    expect(committed).toHaveLength(0);
    expect(tx.patientRelationship.upsert).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });
  it("rejects replacement beside a corrected encounter", async () => {
    visit.encounters = [{ ...originalEncounter, id: "corrected", status: "CORRECTED" }];
    expect((await post()).status).toBe(409);
    expect(tx.encounter.create).not.toHaveBeenCalled();
    expect(tx.servicePointRecord.upsert).not.toHaveBeenCalled();
  });
  it("retains corrected assessment records in GET", async () => {
    saved = { id: "retained-record", data, updatedAt: originalEncounter.updatedAt.toISOString(), templateVersion: input.templateVersion };
    visit.encounters = [{ ...originalEncounter, id: "corrected", status: "CORRECTED" }];
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ record: saved, encounterStatus: "CORRECTED", readOnly: true });
  });
  it("keeps a newer draft read-only when an older encounter is final", async () => {
    visit.encounters = [{ ...originalEncounter, id: "new-draft" }, { ...originalEncounter, id: "older-final", status: "SIGNED" }];
    expect(await (await get()).json()).toMatchObject({ encounterStatus: "DRAFT", readOnly: true });
    expect((await post()).status).toBe(409);
    expect(tx.servicePointRecord.upsert).not.toHaveBeenCalled();
  });
  it("selects only the recorder's display name for attributed record disclosure", async () => {
    await get();
    expect(vi.mocked(db.visit.findFirst).mock.calls[0][0]?.select?.encounters).toMatchObject({
      select: { servicePointRecord: { include: { updatedBy: { select: { displayName: true } } } } },
    });
  });
  it("rejects a stale sequential save and retains the newer plan", async () => {
    expect((await post({ ...input, data: { ...data, carePlan: "Newer plan" } })).status).toBe(200);
    expect((await post({ ...input, expectedRevision: "a".repeat(64) })).status).toBe(409);
    expect(saved.data.carePlan).toBe("Newer plan");
    expect(committed.map(record => record.data.carePlan)).toEqual(["Newer plan"]);
  });
  it("requires the original revision instead of accepting an old client", async () => {
    expect((await post({ ...input, expectedRevision: undefined })).status).toBe(428);
    expect(tx.servicePointRecord.upsert).not.toHaveBeenCalled();
  });
  it("accepts null only for a first encounter and returns the newly saved revision", async () => {
    visit.encounters = [];
    expect((await (await get()).json()).assessmentRevision).toBeNull();
    const response = await post({ ...input, expectedRevision: null });
    expect(response.status).toBe(200);
    expect((await response.json()).assessmentRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(tx.encounter.create).toHaveBeenCalledTimes(1);
  });
  it.each([null, "a".repeat(64)])("rejects an unexpected revision %s before any writes", async expectedRevision => {
    expect((await post({ ...input, expectedRevision })).status).toBe(409);
    expect(tx.visit.update).not.toHaveBeenCalled();
    expect(tx.encounter.update).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });
  it.each(["id", "updatedAt", "status"])("binds the loaded revision to encounter %s", async field => {
    if (field === "id") visit.encounters[0].id = "replacement";
    if (field === "updatedAt") visit.encounters[0].updatedAt = new Date("2026-10-19T20:00:00Z");
    if (field === "status") visit.encounters[0].status = "CORRECTED";
    expect((await post()).status).toBe(409);
    expect(tx.servicePointRecord.upsert).not.toHaveBeenCalled();
  });
  it("advances the conditional encounter revision even under a frozen clock", async () => {
    vi.spyOn(Date, "now").mockReturnValue(originalEncounter.updatedAt.getTime());
    try {
      expect((await post()).status).toBe(200);
      expect(tx.encounter.update).toHaveBeenCalledWith({ where: { id: "encounter", updatedAt: originalEncounter.updatedAt, status: "DRAFT" }, data: { updatedAt: new Date(originalEncounter.updatedAt.getTime() + 1) }, include: { servicePointRecord: true } });
    } finally { vi.restoreAllMocks(); }
  });
  it("returns a usable revision for the next edit and rejects the former revision", async () => {
    const first = await (await post()).json();
    expect(first.assessmentRevision).toBe((await (await get()).json()).assessmentRevision);
    const second = await post({ ...input, expectedRevision: first.assessmentRevision, data: { ...data, carePlan: "Reviewed second edit" } });
    expect(second.status).toBe(200);
    expect((await second.json()).assessmentRevision).not.toBe(first.assessmentRevision);
    expect((await post({ ...input, expectedRevision: first.assessmentRevision })).status).toBe(409);
    expect(saved.data.carePlan).toBe("Reviewed second edit");
  });
  it("rejects reuse of an original revision even with unchanged values", async () => {
    const original = (await (await get()).json()).assessmentRevision;
    expect((await post({ ...input, expectedRevision: original })).status).toBe(200);
    expect((await post({ ...input, expectedRevision: original })).status).toBe(409);
    expect(committed).toHaveLength(1);
  });
  it("binds consecutive saved values to before/after fingerprints and the authenticated session", async () => {
    await post();
    await post({ ...input, expectedRevision: (await (await get()).json()).assessmentRevision, riskLevel: "HIGH", data: { ...data, carePlan: "Different synthetic plan" } });
    const events = vi.mocked(appendAudit).mock.calls.map(call => call[1]);
    expect(events).toHaveLength(2);
    expect(events[0].afterHash).not.toBe(events[1].afterHash);
    expect(events[1].beforeHash).toBe(events[0].afterHash);
    for (const event of events) {
      expect(event).toMatchObject({ sessionId: user.sessionId, facilityId: user.facilityId, userId: user.id });
      expect(event.beforeHash).toMatch(/^assessment-v1:[a-f0-9]{64}$/);
      expect(event.afterHash).toMatch(/^assessment-v1:[a-f0-9]{64}$/);
      expect(JSON.stringify(event)).not.toContain("synthetic");
    }
    expect(events[0].beforeHash).not.toBe(events[0].afterHash);
  });
  it("fingerprints the persisted result rather than raw request values", async () => {
    const persist = tx.servicePointRecord.upsert.getMockImplementation()!;
    tx.servicePointRecord.upsert.mockImplementation(async args => {
      const result = await persist(args);
      result.data = { ...result.data, carePlan: "Persisted synthetic value" };
      return result;
    });
    expect((await post()).status).toBe(200);
    const event = vi.mocked(appendAudit).mock.calls[0][1];
    expect(event.beforeHash).toBe(assessmentAuditFingerprint(user.facilityId, visitId, null));
    expect(event.afterHash).toBe(assessmentAuditFingerprint(user.facilityId, visitId, saved));
    expect(event.afterHash).not.toBe(assessmentAuditFingerprint(user.facilityId, visitId, { ...saved, data: input.data }));
  });
  it("retains prior attribution in the before state when another session updates", async () => {
    expect((await post()).status).toBe(200);
    const first = vi.mocked(appendAudit).mock.calls[0][1];
    vi.mocked(requirePermission).mockResolvedValue({ ...user, id: "second-actor", sessionId: "second-session" } as any);
    expect((await post({ ...input, expectedRevision: (await (await get()).json()).assessmentRevision })).status).toBe(200);
    const second = vi.mocked(appendAudit).mock.calls[1][1];
    expect(second).toMatchObject({ beforeHash: first.afterHash, userId: "second-actor", sessionId: "second-session", facilityId: user.facilityId });
    expect(second.afterHash).not.toBe(first.afterHash);
  });
});
