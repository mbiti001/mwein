import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn(), visit: { findFirst: vi.fn() } } }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { consultationRevision, nextEncounterTime } from "@/lib/consultation-revision";
import { GET, POST } from "./[id]/consultation/route";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const encounterId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor = { id: "clinician", facilityId: "facility-a", sessionId: "session-a" };
const context = { params: Promise.resolve({ id }) };
const notes = { chiefComplaint: "Synthetic headache", historyPresentingIllness: "Synthetic history", generalExamination: "Synthetic findings", disposition: "OUTPATIENT" };
let encounter: any;
let visit: any;
let tx: any;
function request(body: object) { return new Request(`http://localhost/api/visits/${id}/consultation`, { method: "POST", body: JSON.stringify(body) }); }
function save(expectedRevision: string | null | undefined = null, data = notes) { return POST(request({ action: "SAVE_NOTES", expectedRevision, data }), context); }
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(actor as never);
  encounter = { id: encounterId, status: "DRAFT", updatedAt: new Date("2026-10-15T10:00:00Z"), subjective: "Original history", objective: "Original findings", plan: "Original plan", noteFormat: "STRUCTURED" };
  visit = { id, status: "UNDER_CONSULTATION", encounters: [encounter] };
  tx = { auditEvent: { findFirst: vi.fn(async () => ({ reason: vi.mocked(appendAudit).mock.calls.find(([, event]) => event.action === "CONSULTATION_DRAFT_SAVED")?.[1].reason })) }, visit: { findFirst: vi.fn(async () => visit) }, encounter: {
    update: vi.fn(async ({ data }) => ({ ...encounter, ...data })),
    create: vi.fn(async ({ data }) => ({ id: encounterId, updatedAt: new Date(), ...data })),
  } };
  vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn(tx));
  vi.mocked(db.visit.findFirst).mockResolvedValue(visit);
});

describe("consultation recovery and revision boundary", () => {
  it.each([{ code: "P2034" }, { code: "P2010", meta: { code: "40001" } }, { code: "P2010", meta: { code: "40P01" } }])("retries a known-aborted first encounter insert using a fresh scoped visit read: %j", async conflict => {
    const first = { ...tx, visit: { findFirst: vi.fn().mockResolvedValue({ ...visit, status: "AWAITING_CLINICIAN", encounters: [] }) }, encounter: { create: vi.fn().mockRejectedValue(conflict) } };
    const second = { ...tx, visit: { findFirst: vi.fn().mockResolvedValue({ ...visit, encounters: [] }) }, encounter: { create: vi.fn(async ({ data }) => ({ id: encounterId, updatedAt: new Date(), ...data })) } };
    vi.mocked(db.$transaction).mockImplementationOnce(async (work: any) => work(first)).mockImplementationOnce(async (work: any) => work(second));
    const result = await save(null);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ stage: "NOTES_SAVED", draftRevision: expect.any(String) });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    for (const attempt of [first, second]) {
      expect(attempt.visit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: actor.facilityId } }));
      expect(attempt.encounter.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ visitId: id, clinicianId: actor.id, status: "DRAFT" }) }));
    }
    for (const call of vi.mocked(db.$transaction).mock.calls) expect(call[1]).toEqual({ isolationLevel: "Serializable" });
    expect(appendAudit).toHaveBeenCalledTimes(1);
    expect(appendAudit).toHaveBeenCalledWith(second, expect.objectContaining({ userId: actor.id, sessionId: actor.sessionId, action: "CONSULTATION_DRAFT_SAVED" }));
  });
  it.each([{ code: "P2034" }, { code: "P2010", meta: { code: "40001" } }, { code: "P2010", meta: { code: "40P01" } }])("stops after three aborted consultation attempts without confirming a save: %j", async conflict => {
    visit.encounters = [];
    tx.encounter.create.mockRejectedValue(conflict);
    const response = await save(null);
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("draftRevision");
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(tx.visit.findFirst).toHaveBeenCalledTimes(3);
    expect(appendAudit).not.toHaveBeenCalled();
  });
  it.each(["changed revision", "closed visit", "signed encounter", "unavailable facility visit"])("rechecks %s after the aborted transaction instead of blindly replaying writes", async condition => {
    visit.encounters = [];
    const first = { ...tx, encounter: { create: vi.fn().mockRejectedValue({ code: "P2034" }) } };
    const changed = condition === "unavailable facility visit" ? null : {
      ...visit, status: condition === "closed visit" ? "DISCHARGED" : "UNDER_CONSULTATION",
      encounters: condition === "closed visit" ? [] : [{ ...encounter, status: condition === "signed encounter" ? "SIGNED" : "DRAFT" }],
    };
    const second = { ...tx, visit: { findFirst: vi.fn().mockResolvedValue(changed) }, encounter: { create: vi.fn(), update: vi.fn() } };
    vi.mocked(db.$transaction).mockImplementationOnce(async (work: any) => work(first)).mockImplementationOnce(async (work: any) => work(second));
    const response = await save(null);
    expect(response.status).toBe(condition === "unavailable facility visit" ? 404 : 409);
    if (condition === "changed revision") expect(await response.json()).toMatchObject({ details: { code: "CONSULTATION_REVISION_CONFLICT" } });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(second.visit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: actor.facilityId } }));
    expect(second.encounter.create).not.toHaveBeenCalled(); expect(second.encounter.update).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });
  it("reruns the complete consultation after an aborted audit, not just the audit append", async () => {
    visit.encounters = [];
    vi.mocked(appendAudit).mockRejectedValueOnce({ code: "P2010", meta: { code: "40001" } }).mockResolvedValueOnce(undefined as never);
    const response = await save(null);
    expect(response.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.visit.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.encounter.create).toHaveBeenCalledTimes(2);
    expect(appendAudit).toHaveBeenCalledTimes(2);
    // This mock checks retry scope; native PostgreSQL verification must prove rollback.
  });
  it("retries a known-aborted commit and responds only with the successful attempt's revision", async () => {
    visit.encounters = [];
    const firstRecord = { ...encounter, id: "aborted-encounter" };
    const savedRecord = { ...encounter, id: "committed-encounter" };
    tx.encounter.create.mockResolvedValueOnce(firstRecord).mockResolvedValueOnce(savedRecord);
    vi.mocked(db.$transaction).mockImplementationOnce(async (work: any) => {
      await work(tx);
      throw { code: "P2034" };
    }).mockImplementationOnce(async (work: any) => work(tx));
    const response = await save(null);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stage: "NOTES_SAVED", draftRevision: consultationRevision(savedRecord) });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.visit.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.encounter.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(appendAudit).mock.calls.map(([, event]) => event.entityId)).toEqual([firstRecord.id, savedRecord.id]);
    // Call counts include the simulated aborted attempt; they are not durable row counts.
  });
  it.each([{ code: "ECONNRESET" }, { code: "P2010", meta: { code: "08006" } }, { code: "P2010", meta: { code: "P0001" } }])("does not replay consultation writes after an ambiguous connection or arbitrary audit failure: %j", async error => {
    visit.encounters = [];
    vi.mocked(appendAudit).mockRejectedValue(error);
    const response = await save(null);
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("draftRevision");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.encounter.create).toHaveBeenCalledTimes(1);
    expect(appendAudit).toHaveBeenCalledTimes(1);
  });
  it("requires permission before reading or saving", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    expect((await GET(new Request("http://localhost"), context)).status).toBe(403);
    expect((await save()).status).toBe(403);
    expect(db.visit.findFirst).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each(["P2002", "P2003"])("does not retry an integrity conflict: %s", async code => {
    visit.encounters = [];
    vi.mocked(appendAudit).mockRejectedValue({ code });
    const response = await save(null);
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("draftRevision");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.encounter.create).toHaveBeenCalledTimes(1);
  });
  it("scopes recovery to facility and audits disclosed identifiers before responding", async () => {
    const result = await GET(new Request("http://localhost"), context);
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(requirePermission).toHaveBeenCalledWith("encounter.write");
    expect(db.visit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: actor.facilityId } }));
    expect(recordClinicalAccess).toHaveBeenCalledWith(actor, "CONSULTATION_RECOVERY", [{ type: "Visit", id }, { type: "Encounter", id: encounterId }]);
  });
  it("does not disclose missing or other-facility visits", async () => {
    vi.mocked(db.visit.findFirst).mockResolvedValue(null); visit = null;
    expect((await GET(new Request("http://localhost"), context)).status).toBe(404);
    expect((await save()).status).toBe(404);
    expect(tx.visit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: actor.facilityId } }));
    expect(recordClinicalAccess).not.toHaveBeenCalled();
  });
  it("blocks disclosure when its audit fails", async () => {
    vi.mocked(recordClinicalAccess).mockRejectedValue(new Error("audit unavailable"));
    const result = await GET(new Request("http://localhost"), context);
    expect(result.status).toBe(500); expect(await result.text()).not.toContain("Original history");
  });
  it("rejects missing revisions even for older clients", async () => {
    const result = await POST(request({ action: "SAVE_NOTES", data: notes }), context);
    expect(result.status).toBe(428); expect(tx.encounter.update).not.toHaveBeenCalled();
  });
  it("rejects stale saves without changing the encounter or its audit", async () => {
    const result = await save(null);
    expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ details: { code: "CONSULTATION_REVISION_CONFLICT" } });
    expect(tx.encounter.update).not.toHaveBeenCalled(); expect(appendAudit).not.toHaveBeenCalled();
  });
  it("conditionally saves the current revision with attributable before/after fingerprints", async () => {
    const result = await save(consultationRevision(encounter));
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(tx.encounter.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: encounterId, updatedAt: encounter.updatedAt, status: "DRAFT" } }));
    expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ sessionId: actor.sessionId, userId: actor.id, action: "CONSULTATION_DRAFT_SAVED", beforeHash: expect.stringMatching(/^[a-f0-9]{64}$/), afterHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect((await result.json()).draftRevision).not.toBe(consultationRevision(encounter));
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("confirms an identical lost-response retry without another mutation", async () => {
    visit.encounters = [];
    await save(null);
    encounter = await tx.encounter.create.mock.results[0].value; visit.encounters = [encounter];
    const receipt = vi.mocked(appendAudit).mock.calls[0][1].reason;
    tx.auditEvent.findFirst.mockResolvedValue({ reason: receipt });
    tx.encounter.update.mockClear(); vi.mocked(appendAudit).mockClear();
    const result = await save(null);
    expect(result.status).toBe(200); expect((await result.json()).stage).toBe("NOTES_CONFIRMED");
    expect(tx.encounter.update).not.toHaveBeenCalled();
    expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "CONSULTATION_DRAFT_CONFIRMED", sessionId: actor.sessionId }));
    expect((await save(null, { ...notes, historyPresentingIllness: "Changed retry" })).status).toBe(409);
  });
  it("does not confirm a retry if audit persistence fails", async () => {
    visit.encounters = [];
    await save(null);
    encounter = await tx.encounter.create.mock.results[0].value; visit.encounters = [encounter];
    vi.mocked(appendAudit).mockRejectedValue(new Error("audit failed"));
    expect((await save(null)).status).toBe(500);
  });
  it("does not accept identical text after an intervening revision or another actor's save", async () => {
    visit.encounters = []; await save(null);
    encounter = await tx.encounter.create.mock.results[0].value; visit.encounters = [encounter];
    encounter.updatedAt = nextEncounterTime(encounter.updatedAt);
    expect((await save(null)).status).toBe(409);
    tx.auditEvent.findFirst.mockResolvedValue(null);
    expect((await save(null)).status).toBe(409);
  });
  it("keeps closed and signed notes immutable even for identical retries", async () => {
    for (const status of ["COMPLETED", "CANCELLED", "DISCHARGED"]) {
      visit.status = status; expect((await save(consultationRevision(encounter))).status).toBe(409);
    }
    visit.status = "UNDER_CONSULTATION"; encounter.status = "SIGNED";
    expect((await save(consultationRevision(encounter))).status).toBe(409); expect(tx.encounter.update).not.toHaveBeenCalled();
  });
  it("rejects signing an outdated encounter before performing workflow transitions", async () => {
    const result = await POST(request({ action: "SIGN", expectedRevision: null, data: { disposition: "OUTPATIENT" } }), context);
    expect(result.status).toBe(409); expect(tx.encounter.update).not.toHaveBeenCalled();
  });
  it("uses a strictly later timestamp even when the clock has not advanced", () => {
    const future = new Date(Date.now() + 10000);
    expect(nextEncounterTime(future).getTime()).toBe(future.getTime() + 1);
  });
});
