import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: vi.fn(), appointment: { findMany: vi.fn() }, patientProblem: { findMany: vi.fn() },
  referral: { findMany: vi.fn() }, clinicalOrder: { findFirst: vi.fn() },
  catalogItem: { findFirst: vi.fn(), findMany: vi.fn() }, store: { findFirst: vi.fn() },
} }));
vi.mock("@/lib/audit", async (original) => ({ ...await original<typeof import("./audit")>(), appendAudit: vi.fn() }));

import { db } from "./db";
import { appendAudit, auditEntitySetFingerprint } from "./audit";
import { requirePermission } from "./auth";
import { recordOutpatientAccess } from "./outpatient-access";
import { GET as appointments } from "@/app/api/appointments/route";
import { GET as problems } from "@/app/api/patients/[id]/problems/route";
import { GET as referrals } from "@/app/api/referrals/route";
import { GET as dispensing } from "@/app/api/orders/[id]/dispense/route";

const actor = { id: "actor", facilityId: "facility", sessionId: "session" };
const request = new Request("http://localhost/api/test");
const params = { params: Promise.resolve({ id: "record" }) };
const item = { id: "medicine", code: "MED", name: "Private medicine", inventoryBatches: [] };
const scenarios = [
  { name: "appointments", context: "APPOINTMENT_LIST", permission: "visit.read", call: () => appointments(request), query: db.appointment.findMany, where: { facilityId: actor.facilityId } },
  { name: "problems", context: "PATIENT_PROBLEM_LIST", permission: "clinical.history.read", call: () => problems(request, params), query: db.patientProblem.findMany, where: { patientId: "record", facilityId: actor.facilityId } },
  { name: "referrals", context: "REFERRAL_LIST", permission: "referral.read", call: () => referrals(request), query: db.referral.findMany, where: { facilityId: actor.facilityId } },
  { name: "dispensing", context: "DISPENSING_PREVIEW", permission: "pharmacy.dispense", call: () => dispensing(request, params), query: db.clinicalOrder.findFirst, where: { id: "record", visit: { facilityId: actor.facilityId } } },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(actor as Awaited<ReturnType<typeof requirePermission>>);
  vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback({}));
  for (const query of [db.appointment.findMany, db.patientProblem.findMany, db.referral.findMany]) vi.mocked(query).mockResolvedValue([]);
  vi.mocked(db.clinicalOrder.findFirst).mockResolvedValue({ id: "record", prescription: { catalogItemId: item.id, quantity: 10, dispensedQuantity: 0 } } as any);
  vi.mocked(db.catalogItem.findFirst).mockResolvedValue(item as any);
  vi.mocked(db.catalogItem.findMany).mockResolvedValue([item] as any);
  vi.mocked(db.store.findFirst).mockResolvedValue({ id: "store" } as any);
});

for (const scenario of scenarios) describe(`${scenario.name} disclosure`, () => {
  it("requires permission, scopes the query and persists attributable evidence before returning an uncached response", async () => {
    const response = await scenario.call();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requirePermission).toHaveBeenCalledWith(scenario.permission);
    expect(scenario.query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining(scenario.where) }));
    expect(appendAudit).toHaveBeenCalledOnce();
    const event = vi.mocked(appendAudit).mock.calls[0][1];
    expect(event).toMatchObject({ userId: actor.id, facilityId: actor.facilityId, sessionId: actor.sessionId, action: "CLINICAL_RECORDS_ACCESSED" });
    expect(JSON.parse(event.reason!)).toMatchObject({ context: scenario.context, outcome: "AUTHORISED_DISCLOSURE" });
    expect(event.afterHash).toBe(auditEntitySetFingerprint(scenario.name === "dispensing" ? ["record"] : []));
  });

  it("does not disclose data when audit storage fails", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("Private audit failure details"));
    const response = await scenario.call();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    expect(body).not.toContain("Private");
    expect(JSON.parse(body)).toHaveProperty("error");
    expect(JSON.parse(body)).not.toHaveProperty(scenario.name);
  });

  it.each([401, 403])("does not query or disclose records when access returns %i", async (status) => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Access denied"), { status }));
    const response = await scenario.call();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(scenario.query).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });
});

it("keeps large list evidence bounded, deduplicated and free of raw identifiers", async () => {
  const ids = Array.from({ length: 2000 }, (_, i) => `sensitive-record-${i}`);
  await recordOutpatientAccess(actor, "APPOINTMENT_LIST", [...ids, ...ids]);
  const event = vi.mocked(appendAudit).mock.calls[0][1];
  expect(event.afterHash).toBe(auditEntitySetFingerprint(ids));
  expect(JSON.stringify(event).length).toBeLessThan(600);
  expect(JSON.stringify(event)).not.toContain("sensitive-record");
});

it("returns an uncached not-found response for an inaccessible prescription", async () => {
  vi.mocked(db.clinicalOrder.findFirst).mockResolvedValue(null);
  const response = await dispensing(request, params);
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(db.catalogItem.findMany).not.toHaveBeenCalled();
  expect(appendAudit).not.toHaveBeenCalled();
});
