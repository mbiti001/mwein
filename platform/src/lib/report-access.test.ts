import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: vi.fn(), visit: { findMany: vi.fn() }, referral: { count: vi.fn(), findMany: vi.fn() },
  queueEntry: { findMany: vi.fn() }, dispensation: { findMany: vi.fn() }, payment: { findMany: vi.fn() }, catalogItem: { findMany: vi.fn() },
} }));
vi.mock("@/lib/audit", async original => ({ ...await original<typeof import("./audit")>(), appendAudit: vi.fn() }));
import { db } from "./db";
import { requirePermission } from "./auth";
import { appendAudit, auditValueFingerprint } from "./audit";
import { GET as monthly } from "@/app/api/reports/moh-monthly/route";
import { GET as operations } from "@/app/api/reports/operations/route";
const actor = { id: "actor", facilityId: "facility", sessionId: "session", facility: { code: "MMS", name: "Test facility" } };
const cases = [
  { name: "monthly", permission: "reports.clinical.read", context: "MONTHLY_CLINICAL", handler: monthly, query: "month=2026-09", invalid: "month=private-invalid-input" },
  { name: "operations", permission: "reports.operations.read", context: "OPERATIONS", handler: operations, query: "from=2026-09-01&to=2026-09-25", invalid: "from=2026-09-30&to=2026-09-01" },
];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(actor as any);
  vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback({}));
  for (const query of [db.visit.findMany, db.referral.findMany, db.queueEntry.findMany, db.dispensation.findMany, db.payment.findMany, db.catalogItem.findMany]) vi.mocked(query).mockResolvedValue([]);
  vi.mocked(db.referral.count).mockResolvedValue(0);
});
for (const entry of cases) describe(`${entry.name} report controls`, () => {
  const call = (query = entry.query) => entry.handler(new Request(`http://localhost/api/reports/test?${query}`));
  it("audits an empty facility-scoped report before disclosure with a response fingerprint", async () => {
    const response = await call();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requirePermission).toHaveBeenCalledWith(entry.permission);
    expect(db.visit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facilityId: actor.facilityId }) }));
    expect(appendAudit).toHaveBeenCalledOnce();
    const event = vi.mocked(appendAudit).mock.calls[0][1];
    expect(event).toMatchObject({ userId: actor.id, facilityId: actor.facilityId, sessionId: actor.sessionId, action: "REPORT_ACCESSED", afterHash: auditValueFingerprint(body) });
    expect(JSON.parse(event.reason!)).toEqual({ version: 1, context: entry.context, outcome: "AUTHORISED_DISCLOSURE" });
    expect(event.reason).not.toContain("Test facility");
  });
  it.each([401, 403])("does not query data for denied access (%i)", async status => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Access denied"), { status }));
    const response = await call();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(db.visit.findMany).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });
  it("fails closed without disclosing a report when audit persistence fails", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("Private audit failure"));
    const response = await call();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).not.toHaveProperty("summary");
    expect(body).not.toHaveProperty("attendance");
    expect(JSON.stringify(body)).not.toContain("Private");
  });
  it("rejects invalid periods without querying records or allowing caching", async () => {
    const response = await call(entry.invalid);
    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(db.visit.findMany).not.toHaveBeenCalled();
  });
});
it("limits the monthly query to fields used to produce aggregates", async () => {
  await monthly(new Request("http://localhost/api/reports/moh-monthly?month=2026-09"));
  const query = vi.mocked(db.visit.findMany).mock.calls[0][0];
  expect(query?.select?.patient).toEqual({ select: { dateOfBirth: true, estimatedAgeYears: true, sexAtBirth: true } });
  expect(query).not.toHaveProperty("include");
});
