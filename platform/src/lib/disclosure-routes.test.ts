import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./auth", () => ({ requirePermission: vi.fn() }));
vi.mock("./disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("./db", () => ({ db: {
  queueEntry: { findMany: vi.fn() }, dispensation: { findMany: vi.fn() }, payment: { findMany: vi.fn() }, catalogItem: { findMany: vi.fn() },
  appointment: { findMany: vi.fn() }, patientProblem: { findMany: vi.fn() }, referral: { findMany: vi.fn(), count: vi.fn() }, visit: { findMany: vi.fn() },
} }));
import { requirePermission } from "./auth";
import { recordDisclosure } from "./disclosure-audit";
import { db } from "./db";
import { GET as appointments } from "@/app/api/appointments/route";
import { GET as problems } from "@/app/api/patients/[id]/problems/route";
import { GET as referrals } from "@/app/api/referrals/route";
import { GET as operations } from "@/app/api/reports/operations/route";
import { GET as monthly } from "@/app/api/reports/moh-monthly/route";
const actor = { id: "actor", facilityId: "facility-a", sessionId: "session", facility: { code: "MMS" } };
const cases = [
  { name: "operations", run: () => operations(new Request("http://localhost/api/reports/operations?from=2026-09-01&to=2026-09-22")), query: () => db.visit.findMany },
  { name: "appointments", run: () => appointments(new Request("http://localhost/api/appointments")), query: () => db.appointment.findMany },
  { name: "problems", run: () => problems(new Request("http://localhost/"), { params: Promise.resolve({ id: "patient" }) }), query: () => db.patientProblem.findMany },
  { name: "referrals", run: () => referrals(new Request("http://localhost/api/referrals")), query: () => db.referral.findMany },
  { name: "monthly", run: () => monthly(new Request("http://localhost/api/reports/moh-monthly?month=2026-09")), query: () => db.visit.findMany },
];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(actor as any);
  for (const c of cases) vi.mocked(c.query()).mockResolvedValue([]);
  for (const model of [db.queueEntry, db.dispensation, db.payment, db.catalogItem]) vi.mocked(model.findMany).mockResolvedValue([]);
  vi.mocked(db.referral.count).mockResolvedValue(0);
});
describe.each(cases)("$name disclosure", c => {
  it("scopes to facility, audits before disclosure and forbids caching", async () => {
    const response = await c.run();
    expect(response.status).toBe(200);
    expect(c.query()).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facilityId: actor.facilityId }) }));
    expect(recordDisclosure).toHaveBeenCalledWith(actor, expect.any(String), expect.any(Array), ...(["monthly", "operations"].includes(c.name) ? [expect.any(Object)] : []));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    if (c.name === "monthly") expect(requirePermission).toHaveBeenCalledWith("reports.clinical");
  });
  it("does not disclose when audit storage fails", async () => {
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("audit failed"));
    const response = await c.run();
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty(c.name);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("denies unauthorized requests without reading data", async () => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    const response = await c.run();
    expect(response.status).toBe(403);
    expect(c.query()).not.toHaveBeenCalled();
    expect(recordDisclosure).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
