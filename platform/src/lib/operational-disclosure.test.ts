import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: Object.fromEntries(["appointment", "referral", "servicePointRecord", "encounter", "queueEntry", "servicePointControl", "visit", "patientRelationship", "user", "role"].map(name => [name, { findMany: vi.fn(), findFirst: vi.fn() }])) }));
import { requirePermission } from "@/lib/auth";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { db } from "@/lib/db";
import { GET as followUps } from "@/app/api/follow-ups/route";
import { GET as queues } from "@/app/api/queues/route";
import { GET as servicePoints } from "@/app/api/service-points/route";
import { GET as staff } from "@/app/api/admin/users/route";
const id = "11111111-1111-4111-8111-111111111111";
const cases = [
  { name: "follow-ups", read: () => followUps(), context: "FOLLOW_UPS" },
  { name: "queues", read: () => queues(), context: "QUEUES" },
  { name: "service-point record", read: () => servicePoints(new Request(`http://localhost/?visitId=${id}`)), context: "SERVICE_POINTS" },
  { name: "service-point metrics", read: () => servicePoints(new Request("http://localhost/")), context: "SERVICE_POINTS" },
  { name: "staff", read: () => staff(), context: "STAFF_ACCESS" },
];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({ id: "actor", facilityId: "facility-a", sessionId: "session", roles: ["FACILITY_ADMIN"], permissions: ["admin.assign_governance"], facility: { timezone: "Africa/Nairobi" } } as any);
  for (const model of Object.values(db) as any[]) model.findMany.mockResolvedValue([]);
  vi.mocked(db.visit.findFirst).mockResolvedValue({ id, patientId: "patient", encounters: [] } as any);
});
it.each(cases)("audits $name before returning private data", async ({ read, context }) => {
  const response = await read();
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(vi.mocked(recordDisclosure).mock.calls[0][0]).toMatchObject({ facilityId: "facility-a", sessionId: "session" });
  expect(vi.mocked(recordDisclosure).mock.calls[0][1]).toBe(context);
});
it.each(cases)("withholds $name when audit persistence fails", async ({ read }) => {
  vi.mocked(recordDisclosure).mockRejectedValue(new Error("audit unavailable"));
  const response = await read(); expect(response.status).toBe(500);
  expect(await response.json()).not.toHaveProperty("worklists");
});
it.each(cases)("denies unauthorized $name access before querying", async ({ read }) => {
  vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
  expect((await read()).status).toBe(403);
  for (const model of Object.values(db) as any[]) { expect(model.findMany).not.toHaveBeenCalled(); expect(model.findFirst).not.toHaveBeenCalled(); }
});
it("limits the shared recall list to scheduling information and facility-scoped queries", async () => {
  await followUps();
  expect(vi.mocked(db.referral.findMany).mock.calls[0][0]?.select).not.toHaveProperty("reason");
  expect(vi.mocked(db.servicePointRecord.findMany).mock.calls[0][0]?.select).not.toHaveProperty("riskLevel");
  expect(vi.mocked(db.appointment.findMany).mock.calls[0][0]?.where).toMatchObject({ facilityId: "facility-a" });
  expect(vi.mocked(db.referral.findMany).mock.calls[0][0]?.where).toMatchObject({ facilityId: "facility-a" });
  expect(vi.mocked(db.encounter.findMany).mock.calls[0][0]?.where).toMatchObject({ visit: { facilityId: "facility-a" } });
});
