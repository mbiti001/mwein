import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  queueEntry: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  servicePointControl: { findUnique: vi.fn() }, visit: { update: vi.fn() }, $transaction: vi.fn(),
} }));
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { POST } from "./route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = { id: "staff", facilityId: "facility-a", permissions: ["triage.write", "encounter.write", "billing.write"] };
const entry = { id, visitId: "visit", servicePoint: "TRIAGE", status: "WAITING", priority: "ROUTINE", visit: { status: "AWAITING_TRIAGE", clinicallyClosedAt: null } };
const post = (body: object) => POST(new Request("http://localhost/api/queues", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(actor as never);
  vi.mocked(db.$transaction).mockImplementation(async (operation: any) => operation(db));
  vi.mocked(db.queueEntry.findFirst).mockResolvedValue(entry as never);
  vi.mocked(db.queueEntry.update).mockResolvedValue(entry as never);
  vi.mocked(db.servicePointControl.findUnique).mockResolvedValue(null);
});
describe("queue handoff boundaries", () => {
  it("checks a pause on direct start, not only call-next", async () => {
    vi.mocked(db.servicePointControl.findUnique).mockResolvedValue({ paused: true, pauseReason: "Staff handover" } as never);
    expect((await post({ action: "START", queueEntryId: id })).status).toBe(409);
    expect(db.queueEntry.update).not.toHaveBeenCalled();
  });
  it("prevents a transfer from duplicating an existing destination task", async () => {
    vi.mocked(db.queueEntry.findFirst).mockResolvedValueOnce(entry as never).mockResolvedValueOnce({ id: "existing" } as never);
    expect((await post({ action: "TRANSFER", queueEntryId: id, targetServicePoint: "CONSULTATION", reason: "Clinical review required" })).status).toBe(409);
    expect(db.queueEntry.create).not.toHaveBeenCalled(); expect(db.queueEntry.update).not.toHaveBeenCalled();
  });
  it("allows outstanding billing to start after clinical closure", async () => {
    vi.mocked(db.queueEntry.findFirst).mockResolvedValue({ ...entry, servicePoint: "BILLING", visit: { status: "DISCHARGED", clinicallyClosedAt: new Date() } } as never);
    expect((await post({ action: "START", queueEntryId: id })).status).toBe(200);
    expect(db.visit.update).not.toHaveBeenCalled();
  });
  it("never transfers a clinically closed visit back into clinical care", async () => {
    vi.mocked(db.queueEntry.findFirst).mockResolvedValue({ ...entry, servicePoint: "BILLING", visit: { status: "DISCHARGED", clinicallyClosedAt: new Date() } } as never);
    expect((await post({ action: "TRANSFER", queueEntryId: id, targetServicePoint: "TRIAGE", reason: "Return to clinical care" })).status).toBe(409);
  });
  it("scopes queue selection to the signed-in facility", async () => {
    vi.mocked(db.queueEntry.findFirst).mockResolvedValue(null);
    expect((await post({ action: "START", queueEntryId: id })).status).toBe(404);
    expect(db.queueEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, visit: { facilityId: actor.facilityId } } }));
  });
  it("does not call a terminal or clinically closed visit at a clinical service point", async () => {
    vi.mocked(db.queueEntry.findFirst).mockResolvedValue(null);
    vi.mocked(db.queueEntry.findMany).mockResolvedValue([]);
    expect((await post({ action: "CALL_NEXT", servicePoint: "TRIAGE" })).status).toBe(409);
    expect(db.queueEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ visit: { facilityId: actor.facilityId, clinicallyClosedAt: null, status: { notIn: ["COMPLETED", "CANCELLED", "DISCHARGED"] } } }) }));
  });
});
