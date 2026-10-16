import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  queueEntry: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  servicePointControl: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  visit: { update: vi.fn() }, $transaction: vi.fn(),
} }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { GET, POST } from "./route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = { id: "operator", sessionId: "session", facilityId: "facility-a", permissions: ["triage.write", "encounter.write"] };
const entry = { id, visitId: "visit-a", servicePoint: "TRIAGE", status: "WAITING", priority: "ROUTINE", enteredAt: new Date("2026-10-16T08:00:00Z"), visit: { status: "AWAITING_TRIAGE", clinicallyClosedAt: null, patient: { fullName: "Synthetic queue record" } } };
const post = (body: object) => POST(new Request("http://localhost/api/queues", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(actor as never);
  vi.mocked(db.$transaction).mockImplementation(async (operation: any) => operation(db));
  vi.mocked(db.queueEntry.findFirst).mockResolvedValue(entry as never);
  vi.mocked(db.queueEntry.findMany).mockResolvedValue([]);
  vi.mocked(db.servicePointControl.findMany).mockResolvedValue([]);
  vi.mocked(db.servicePointControl.findUnique).mockResolvedValue(null);
  vi.mocked(db.servicePointControl.upsert).mockResolvedValue({ id: "control" } as never);
  vi.mocked(db.queueEntry.update).mockResolvedValue(entry as never);
  vi.mocked(db.queueEntry.create).mockResolvedValue({ ...entry, id: "destination" } as never);
});
describe("queue access and action audit", () => {
  it.each([401, 403])("denies %i before any domain query or transaction", async status => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status }));
    expect((await GET()).status).toBe(status);
    expect((await post({ action: "START", queueEntryId: id })).status).toBe(status);
    expect(db.queueEntry.findMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("scopes both lists and controls, retains priority order and audits returned history", async () => {
    const urgent = { ...entry, id: "urgent", priority: "URGENT" };
    const history = { ...entry, id: "completed", status: "COMPLETED", completedAt: new Date("2026-10-16T08:17:00Z") };
    vi.mocked(db.queueEntry.findMany).mockResolvedValueOnce([entry, urgent] as never).mockResolvedValueOnce([history] as never);
    const response = await GET(); const body = await response.json();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.entries.map((row: { id: string }) => row.id)).toEqual(["urgent", id]);
    expect(body.history[0].durationMinutes).toBe(17);
    for (const [query] of vi.mocked(db.queueEntry.findMany).mock.calls) expect(query?.where?.visit).toMatchObject({ facilityId: actor.facilityId });
    expect(db.queueEntry.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ take: 60, where: expect.objectContaining({ completedAt: { gte: expect.any(Date) } }) }));
    expect(db.servicePointControl.findMany).toHaveBeenCalledWith({ where: { facilityId: actor.facilityId } });
    expect(recordDisclosure).toHaveBeenCalledWith(actor, "QUEUES", ["urgent", id, "completed"]);
  });
  it("withholds records while disclosure auditing is pending and on rejection", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(recordDisclosure).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    let returned = false; const pending = GET().then(response => { returned = true; return response; });
    await vi.waitFor(() => expect(recordDisclosure).toHaveBeenCalled()); expect(returned).toBe(false);
    reject(new Error("Synthetic audit outage"));
    const response = await pending; expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("entries");
  });
  it("does not audit or disclose a partial result after a read failure", async () => {
    vi.mocked(db.servicePointControl.findMany).mockRejectedValue(new Error("Synthetic control failure"));
    const response = await GET(); expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("entries"); expect(recordDisclosure).not.toHaveBeenCalled();
  });
  it.each(["START", "ESCALATE", "TRANSFER"])("rejects foreign %s before writes", async action => {
    vi.mocked(db.queueEntry.findFirst).mockResolvedValue(null);
    expect((await post({ action, queueEntryId: id, targetServicePoint: "CONSULTATION", reason: "Synthetic access review" })).status).toBe(404);
    expect(db.queueEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, visit: { facilityId: actor.facilityId } } }));
    expect(db.queueEntry.update).not.toHaveBeenCalled(); expect(appendAudit).not.toHaveBeenCalled();
  });
  it.each(["START", "ESCALATE", "TRANSFER"])("requires source service permission for %s", async action => {
    vi.mocked(requirePermission).mockResolvedValue({ ...actor, permissions: ["encounter.write"] } as never);
    expect((await post({ action, queueEntryId: id, targetServicePoint: "CONSULTATION", reason: "Synthetic access review" })).status).toBe(403);
    expect(db.queueEntry.update).not.toHaveBeenCalled(); expect(appendAudit).not.toHaveBeenCalled();
  });
  it("requires destination permission before transfer writes", async () => {
    expect((await post({ action: "TRANSFER", queueEntryId: id, targetServicePoint: "PHARMACY", reason: "Synthetic transfer" })).status).toBe(403);
    expect(db.queueEntry.update).not.toHaveBeenCalled();
  });
  it("retains transfer actor, reason, before/after service and serializable boundary", async () => {
    vi.mocked(db.queueEntry.findFirst).mockResolvedValueOnce(entry as never).mockResolvedValueOnce(null);
    expect((await post({ action: "TRANSFER", queueEntryId: id, targetServicePoint: "CONSULTATION", reason: "Synthetic transfer review" })).status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(db.queueEntry.create).toHaveBeenCalledWith({ data: { visitId: entry.visitId, servicePoint: "CONSULTATION", priority: "ROUTINE" } });
    expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({ userId: actor.id, action: "QUEUE_PATIENT_TRANSFERRED", entityId: entry.visitId, reason: "Synthetic transfer review", beforeHash: "TRIAGE", afterHash: "CONSULTATION" }));
  });
  it("records escalation with session attribution without changing priority or sending a handover", async () => {
    const response = await post({ action: "ESCALATE", queueEntryId: id, reason: "Synthetic lead review requested" });
    expect(response.status).toBe(200);
    expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({ facilityId: actor.facilityId, userId: actor.id, sessionId: actor.sessionId, action: "QUEUE_REVIEW_ESCALATED", afterHash: "TRIAGE:ROUTINE" }));
    expect(db.queueEntry.update).not.toHaveBeenCalled(); expect(db.visit.update).not.toHaveBeenCalled();
  });
  it.each(["CALL_NEXT", "SET_PAUSED"])("requires service permission for %s", async action => {
    expect((await post({ action, servicePoint: "PHARMACY", paused: true, reason: "Synthetic pause" })).status).toBe(403);
    expect(db.servicePointControl.upsert).not.toHaveBeenCalled(); expect(db.queueEntry.update).not.toHaveBeenCalled();
  });
  it("does not allow ordinary operators to change targets", async () => {
    expect((await post({ action: "SET_TARGET", servicePoint: "TRIAGE", targetMinutes: 30 })).status).toBe(403);
    expect(db.servicePointControl.upsert).not.toHaveBeenCalled();
  });
  it("scopes administrative target updates and retains session evidence", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ...actor, permissions: ["admin.dashboard"] } as never);
    expect((await post({ action: "SET_TARGET", servicePoint: "TRIAGE", targetMinutes: 25 })).status).toBe(200);
    expect(db.servicePointControl.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { facilityId_servicePoint: { facilityId: actor.facilityId, servicePoint: "TRIAGE" } } }));
    expect(appendAudit).toHaveBeenCalledWith(db, expect.objectContaining({ sessionId: actor.sessionId, action: "SERVICE_POINT_TARGET_UPDATED", afterHash: "TRIAGE:25" }));
  });
  it("requires a pause reason and rejects busy call-next without changing state", async () => {
    expect((await post({ action: "SET_PAUSED", servicePoint: "TRIAGE", paused: true })).status).toBe(422);
    expect((await post({ action: "CALL_NEXT", servicePoint: "TRIAGE" })).status).toBe(409);
    expect(db.servicePointControl.upsert).not.toHaveBeenCalled(); expect(db.queueEntry.update).not.toHaveBeenCalled();
  });
  it("withholds mutation success when transactional audit rejects (mock does not prove rollback)", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("Synthetic audit rejection"));
    const response = await post({ action: "START", queueEntryId: id });
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("entry");
  });
});
