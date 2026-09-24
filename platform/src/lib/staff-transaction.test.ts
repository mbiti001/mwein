import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
import { db } from "./db";
import { requirePermission } from "./auth";
import { appendAudit } from "./audit";
import { PATCH } from "@/app/api/admin/users/route";
const actor = { id: "actor", facilityId: "facility", sessionId: "session", roles: ["FACILITY_ADMIN"], permissions: ["admin.users", "admin.assign_governance"] };
const target = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "ACTIVE", passwordHash: "private", roles: [{ role: { code: "DATA_PROTECTION_OFFICER" } }] };
const tx = { user: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() }, role: { findUnique: vi.fn() }, userRole: { deleteMany: vi.fn(), create: vi.fn() }, session: { deleteMany: vi.fn() } };
const call = () => PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: target.id, status: "DISABLED" }) }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(actor as any);
  vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback(tx));
  tx.user.findFirst.mockResolvedValue(target); tx.user.count.mockResolvedValue(1);
  tx.user.update.mockResolvedValue({ ...target, status: "DISABLED" });
});
it("checks target scope and role within the same serializable change transaction", async () => {
  const response = await call();
  expect(response.status).toBe(200);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: target.id, facilityId: actor.facilityId } }));
  expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: target.id } });
  expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ facilityId: actor.facilityId, sessionId: actor.sessionId, action: "STAFF_ACCESS_UPDATED" }));
  expect(await response.json()).not.toHaveProperty("user.passwordHash");
});
it("uses current transaction-visible governance roles to reject an HR change", async () => {
  vi.mocked(requirePermission).mockResolvedValue({ ...actor, roles: ["HR_ADMIN"], permissions: ["admin.users"] } as any);
  expect((await call()).status).toBe(403);
  expect(tx.user.update).not.toHaveBeenCalled();
  expect(tx.session.deleteMany).not.toHaveBeenCalled();
});
it("does not update a target absent from the actor's facility", async () => {
  tx.user.findFirst.mockResolvedValue(null);
  expect((await call()).status).toBe(404);
  expect(tx.user.update).not.toHaveBeenCalled();
});
it("does not confirm a change when its transactional audit fails", async () => {
  vi.mocked(appendAudit).mockRejectedValue(new Error("Audit unavailable"));
  expect((await call()).status).toBe(500);
});
