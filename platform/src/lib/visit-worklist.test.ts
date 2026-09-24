import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./auth", () => ({ requirePermission: vi.fn() }));
vi.mock("./clinical-access", () => ({ recordClinicalAccess: vi.fn() }));
vi.mock("./db", () => ({ db: { visit: { findMany: vi.fn() } } }));
import { requirePermission } from "./auth";
import { recordClinicalAccess } from "./clinical-access";
import { db } from "./db";
import { GET } from "@/app/api/visits/route";
const actor = { id: "user", facilityId: "facility-a", permissions: ["visit.read"] };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(actor as any); vi.mocked(db.visit.findMany).mockResolvedValue([]); });
it("loads every active department while retaining facility scope and queue-only data minimization", async () => {
  const result = await GET();
  expect(result.status).toBe(200);
  const query = vi.mocked(db.visit.findMany).mock.calls[0][0];
  expect(query?.where?.facilityId).toBe("facility-a");
  expect(query?.select?.queues).toEqual({ where: { status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } }, select: { servicePoint: true, status: true, enteredAt: true }, orderBy: { enteredAt: "desc" } });
  expect(query?.select).not.toHaveProperty("orders"); expect(query?.select).not.toHaveProperty("invoice");
  expect(recordClinicalAccess).toHaveBeenCalledWith(actor, "VISIT_WORKLIST", []);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
});
it("does not return the worklist when disclosure audit fails", async () => {
  vi.mocked(recordClinicalAccess).mockRejectedValue(new Error("unavailable"));
  const result = await GET(); expect(result.status).toBe(500); expect(await result.json()).not.toHaveProperty("visits");
});
it("rejects unauthorized callers before querying queues", async () => {
  vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
  expect((await GET()).status).toBe(403); expect(db.visit.findMany).not.toHaveBeenCalled();
});
