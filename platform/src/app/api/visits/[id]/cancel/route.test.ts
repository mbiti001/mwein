import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), visit: vi.fn(), control: vi.fn(), transaction: vi.fn(),
  queues: vi.fn(), orders: vi.fn(), claims: vi.fn(), invoice: vi.fn(), appointment: vi.fn(),
  cancellation: vi.fn(), updateVisit: vi.fn(), audit: vi.fn(), access: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/audit", () => ({ appendAudit: mocks.audit }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: mocks.access }));
vi.mock("@/lib/db", () => ({ db: {
  visit: { findFirst: mocks.visit }, servicePointControl: { findUnique: mocks.control }, $transaction: mocks.transaction,
} }));
import { GET, POST } from "./route";

const id = "11111111-1111-4111-8111-111111111111";
const actor = { id: "actor", facilityId: "facility-a", sessionId: "session" };
const context = { params: Promise.resolve({ id }) };
const input = { reasonCode: "PATIENT_LEFT_BEFORE_CARE", details: "Attendance reviewed: patient left before receiving care" };
const preview = (reason = "") => GET(new Request(`https://test/api/visits/${id}/cancel${reason ? `?reasonCode=${reason}` : ""}`), context);
const cancel = (body: unknown = input) => POST(new Request(`https://test/api/visits/${id}/cancel`, { method: "POST", body: JSON.stringify(body) }), context);
const activeVisit = () => ({
  id, facilityId: actor.facilityId, visitNumber: "MMS-V-2026-000001", status: "AWAITING_CLINICIAN",
  clinic: "General", visitType: "WALK_IN", priority: "ROUTINE", clinicallyClosedAt: null,
  patient: { id: "patient", fullName: "Synthetic Patient", patientNumber: "MMS-2026-000001" },
  appointmentId: "appointment", cancellation: null, encounters: [], clinicDocuments: [],
  queues: [
    { servicePoint: "CONSULTATION", status: "WAITING", enteredAt: new Date(Date.now() - 45 * 60_000) },
    { servicePoint: "BILLING", status: "CALLED", enteredAt: new Date() },
  ],
  orders: [{ id: "draft-order", status: "DRAFT" }, { id: "requested-order", status: "REQUESTED" }, { id: "old-order", status: "CANCELLED" }],
  invoice: { id: "invoice", status: "OPEN", payments: [], claims: [{ id: "draft-claim", status: "DRAFT" }, { id: "old-claim", status: "CANCELLED" }] },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue(actor);
  mocks.visit.mockResolvedValue(activeVisit());
  mocks.control.mockResolvedValue({ targetMinutes: 30 });
  mocks.cancellation.mockResolvedValue({ id: "cancellation", visitId: id, ...input, cancelledAt: new Date(), cancelledById: actor.id });
  mocks.updateVisit.mockResolvedValue({ ...activeVisit(), status: "CANCELLED" });
  mocks.transaction.mockImplementation(async callback => callback({
    visit: { findFirst: mocks.visit, update: mocks.updateVisit }, servicePointControl: { findUnique: mocks.control },
    queueEntry: { updateMany: mocks.queues }, clinicalOrder: { updateMany: mocks.orders },
    claim: { updateMany: mocks.claims }, invoice: { update: mocks.invoice }, appointment: { updateMany: mocks.appointment },
    visitCancellation: { create: mocks.cancellation },
  }));
});

describe("visit cancellation review", () => {
  it("returns an audited, uncached, facility-scoped preview without clinical or financial details", async () => {
    const response = await preview();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.permission).toHaveBeenCalledWith("visit.cancel");
    expect(mocks.visit).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: actor.facilityId } }));
    expect(mocks.access).toHaveBeenCalledWith(actor, "VISIT_CANCELLATION_REVIEW", [{ type: "Visit", id }]);
    expect(await response.json()).toEqual({
      visitId: id, visitNumber: "MMS-V-2026-000001", patient: activeVisit().patient,
      status: "AWAITING_CLINICIAN", canCancel: true, blockers: [], overdueEligible: true, emergencyCare: false,
      impact: { activeQueues: 2, pendingOrders: 2, draftClaims: 1, voidInvoice: true, cancelAppointment: true },
    });
    expect(mocks.cancellation).not.toHaveBeenCalled();
  });

  it("reports generic completed-care blockers without exposing service names", async () => {
    mocks.visit.mockResolvedValue({ ...activeVisit(), orders: [{ id: "order", status: "COMPLETED", displayName: "Sensitive service" }] });
    const body = await (await preview()).json();
    expect(body.canCancel).toBe(false);
    expect(body.blockers.join(" ")).toContain("Completed care");
    expect(JSON.stringify(body)).not.toContain("Sensitive service");
  });

  it("checks the chosen overdue reason against the configured waiting target", async () => {
    mocks.control.mockResolvedValue({ targetMinutes: 60 });
    const body = await (await preview("OVERDUE_UNPROCESSED")).json();
    expect(body.overdueEligible).toBe(false);
    expect(body.canCancel).toBe(false);
    expect(body.blockers).toContain("This visit is not overdue in a waiting queue");
    expect(mocks.control).toHaveBeenCalledWith({ where: { facilityId_servicePoint: { facilityId: actor.facilityId, servicePoint: "CONSULTATION" } } });
  });

  it("handles visits with no active queue or invoice without inventing cancellation impact", async () => {
    mocks.visit.mockResolvedValue({ ...activeVisit(), queues: [], orders: [], invoice: null, appointmentId: null });
    const body = await (await preview()).json();
    expect(body.canCancel).toBe(true);
    expect(body.overdueEligible).toBe(false);
    expect(body.impact).toEqual({ activeQueues: 0, pendingOrders: 0, draftClaims: 0, voidInvoice: false, cancelAppointment: false });
  });

  it.each(["SHA_BENEFIT_OR_ELIGIBILITY", "PRIVATE_COVER_NOT_AVAILABLE"])("previews the emergency safeguard for %s", async reason => {
    mocks.visit.mockResolvedValue({ ...activeVisit(), priority: "EMERGENCY" });
    const body = await (await preview(reason)).json();
    expect(body.emergencyCare).toBe(true);
    expect(body.canCancel).toBe(false);
    expect(body.blockers.join(" ")).toContain("Do not delay");
  });

  it("validates the reason before reading a clinical record", async () => {
    expect((await preview("INVALID")).status).toBe(422);
    expect(mocks.visit).not.toHaveBeenCalled();
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("does not disclose a preview if access auditing fails", async () => {
    mocks.access.mockRejectedValue(new Error("Audit unavailable"));
    const response = await preview();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Synthetic Patient");
  });
});

describe("governed visit cancellation", () => {
  it.each([preview, cancel])("requires cancellation authority before database access", async operation => {
    mocks.permission.mockRejectedValue(Object.assign(new Error("Permission denied"), { status: 403 }));
    expect((await operation()).status).toBe(403);
    expect(mocks.visit).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([preview, cancel])("hides missing and foreign facility visits", async operation => {
    mocks.visit.mockResolvedValue(null);
    expect((await operation()).status).toBe(404);
    expect(mocks.visit).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: actor.facilityId } }));
    expect(mocks.cancellation).not.toHaveBeenCalled();
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("cancels only unstarted work and records attribution within one serializable transaction", async () => {
    const response = await cancel();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.queues).toHaveBeenCalledWith({ where: { visitId: id, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, data: { status: "CANCELLED", completedAt: expect.any(Date) } });
    expect(mocks.orders).toHaveBeenCalledWith({ where: { visitId: id, status: { in: ["DRAFT", "REQUESTED"] } }, data: { status: "CANCELLED", completedAt: expect.any(Date) } });
    expect(mocks.claims).toHaveBeenCalledWith({ where: { invoiceId: "invoice", status: "DRAFT" }, data: { status: "CANCELLED" } });
    expect(mocks.invoice).toHaveBeenCalledWith({ where: { id: "invoice" }, data: { status: "VOID" } });
    expect(mocks.appointment).toHaveBeenCalledWith({ where: { id: "appointment", facilityId: actor.facilityId }, data: { status: "CANCELLED" } });
    expect(mocks.cancellation).toHaveBeenCalledWith({ data: expect.objectContaining({ facilityId: actor.facilityId, visitId: id, ...input, cancelledById: actor.id, cancelledAt: expect.any(Date) }) });
    expect(mocks.updateVisit).toHaveBeenCalledWith({ where: { id }, data: { status: "CANCELLED" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ facilityId: actor.facilityId, userId: actor.id, sessionId: actor.sessionId, action: "VISIT_CANCELLED", entityId: id }));
  });

  it("rechecks care recorded after an otherwise eligible preview", async () => {
    expect((await (await preview()).json()).canCancel).toBe(true);
    mocks.visit.mockResolvedValue({ ...activeVisit(), encounters: [{ status: "SIGNED" }] });
    const response = await cancel();
    expect(response.status).toBe(409);
    expect((await response.json()).details.blockers.join(" ")).toContain("already signed");
    expect(mocks.queues).not.toHaveBeenCalled();
    expect(mocks.invoice).not.toHaveBeenCalled();
    expect(mocks.cancellation).not.toHaveBeenCalled();
  });

  it.each([
    { cancellation: { id: "earlier-cancellation" }, status: "CANCELLED" },
    { clinicallyClosedAt: new Date() },
    { clinicDocuments: [{ status: "SIGNED", kind: "MATERNITY" }] },
    { orders: [{ id: "ongoing-care", status: "IN_PROGRESS" }] },
    { invoice: { id: "invoice", status: "OPEN", payments: [{ status: "PENDING" }], claims: [] } },
    { invoice: { id: "invoice", status: "OPEN", payments: [], claims: [{ id: "claim", status: "REJECTED" }] } },
  ])("rejects protected or already-cancelled visits before any write: %j", state => {
    mocks.visit.mockResolvedValue({ ...activeVisit(), ...state });
    return cancel().then(response => {
      expect(response.status).toBe(409);
      expect(mocks.queues).not.toHaveBeenCalled();
      expect(mocks.orders).not.toHaveBeenCalled();
      expect(mocks.cancellation).not.toHaveBeenCalled();
    });
  });

  it("rejects an overdue reason if attendance is still inside the waiting target", async () => {
    mocks.control.mockResolvedValue({ targetMinutes: 60 });
    const response = await cancel({ ...input, reasonCode: "OVERDUE_UNPROCESSED" });
    expect(response.status).toBe(409);
    expect(mocks.cancellation).not.toHaveBeenCalled();
  });

  it("keeps SHA evidence with the cancellation record", async () => {
    const sha = { reasonCode: "SHA_BENEFIT_OR_ELIGIBILITY", details: "Routine eligibility checked by the patient desk", shaOutcome: "BENEFIT_NOT_COVERED", shaEligibilityReference: "SYNTHETIC-CHECK-1" };
    expect((await cancel(sha)).status).toBe(200);
    expect(mocks.cancellation).toHaveBeenCalledWith({ data: expect.objectContaining({ ...sha, policyVersion: expect.any(String) }) });
  });

  it.each([{ ...input, details: " " }, { ...input, reasonCode: "SHA_BENEFIT_OR_ELIGIBILITY" }])("rejects incomplete evidence before starting a transaction: %j", async body => {
    expect((await cancel(body)).status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns a recoverable conflict for concurrent changes without claiming success", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2034" });
    const response = await cancel();
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("cancellation");
  });
});
