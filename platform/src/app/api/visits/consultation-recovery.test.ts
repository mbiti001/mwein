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
  it("requires permission before reading or saving", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    expect((await GET(new Request("http://localhost"), context)).status).toBe(403);
    expect((await save()).status).toBe(403);
    expect(db.visit.findFirst).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
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
