import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn(), SESSION_IDLE_MS: 1800000 }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
import { db } from "./db";
import { requirePermission } from "./auth";
import { appendAudit } from "./audit";
import { PATCH } from "@/app/api/admin/users/route";
const actor = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", facilityId: "facility", sessionId: "session", roles: ["FACILITY_ADMIN"], permissions: ["admin.users", "admin.assign_governance"] };
const target = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "ACTIVE", passwordHash: "private", roles: [{ role: { code: "DATA_PROTECTION_OFFICER" } }] };
const tx = { user: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() }, role: { findUnique: vi.fn() }, userRole: { deleteMany: vi.fn(), create: vi.fn() }, session: { findUnique: vi.fn(), deleteMany: vi.fn() } };
const call = () => PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: target.id, status: "DISABLED" }) }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(actor as any);
  vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback(tx));
  tx.user.findFirst.mockResolvedValue(target); tx.user.count.mockResolvedValue(1);
  tx.user.update.mockResolvedValue({ ...target, status: "DISABLED" });
  tx.session.findUnique.mockResolvedValue(actorSession());
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
  tx.session.findUnique.mockResolvedValue(actorSession(["HR_ADMIN"], ["admin.users"]));
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

function actorSession(roles = actor.roles, permissions = actor.permissions) {
  return { id: actor.sessionId, userId: actor.id, createdAt: new Date(), expiresAt: new Date(Date.now() + 600_000), lastSeenAt: new Date(), mfaVerifiedAt: new Date(),
    user: { id: actor.id, facilityId: actor.facilityId, status: "ACTIVE", mustChangePassword: false,
      mfaCredential: { enabledAt: new Date(), recoveryRequired: false },
      roles: roles.map(code => ({ role: { code, permissions: permissions.map(code => ({ permission: { code } })) } })),
    },
  };
}
const conflicts = [{ code: "P2034" }, { code: "P2010", meta: { code: "40001" } }, { code: "P2010", meta: { code: "40P01" } }];
const reassign = (patch: object = {}) => PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: target.id, roleCode: "DATA_PROTECTION_OFFICER", ...patch }) }));

// Model transactional staging to inspect retry scope. This does not prove native SQL rollback.
function stagedStaff(errors: unknown[] = [], failAt: "role" | "audit" | "commit" = "audit") {
  let saved: any = { target: structuredClone(target), actorSession: actorSession(), adminCount: 2,
    selectedRole: { id: "dpo-role", code: "DATA_PROTECTION_OFFICER" }, sessions: ["target-session"], audits: [] };
  const attempts: any[] = [];
  let afterAbort = (_saved: any, _attempt: number) => {};
  vi.mocked(db.$transaction).mockImplementation(async (work: any) => {
    const state = structuredClone(saved);
    const index = attempts.length;
    const fail = () => { if (index < errors.length) throw errors[index]; };
    const attempt = {
      session: { findUnique: vi.fn(async () => state.actorSession), deleteMany: vi.fn(async () => { state.sessions = []; return { count: 1 }; }) },
      user: {
        findFirst: vi.fn(async () => state.target), count: vi.fn(async () => state.adminCount),
        update: vi.fn(async ({ data }: any) => { Object.assign(state.target, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))); return structuredClone(state.target); }),
      },
      role: { findUnique: vi.fn(async () => state.selectedRole) },
      userRole: {
        deleteMany: vi.fn(async () => { state.target.roles = []; }),
        create: vi.fn(async () => { state.target.roles = [{ role: state.selectedRole }]; if (failAt === "role") fail(); }),
      },
    };
    attempts.push(attempt);
    vi.mocked(appendAudit).mockImplementation(async (client, event) => {
      expect(client).toBe(attempt);
      state.audits.push(event);
      if (failAt === "audit") fail();
      return { id: "modeled-audit" } as never;
    });
    try {
      const result = await work(attempt);
      if (failAt === "commit") fail();
      saved = state;
      return result;
    } catch (error) { afterAbort(saved, index); throw error; }
  });
  return { get saved() { return saved; }, attempts, afterAbort(callback: typeof afterAbort) { afterAbort = callback; } };
}

it.each(conflicts)("recovers DPO reassignment after known-aborted audit %j with one modeled revocation and audit", async conflict => {
  const model = stagedStaff([conflict]);
  const response = await reassign();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).not.toHaveProperty("user.passwordHash");
  expect(model.attempts).toHaveLength(2);
  expect(model.attempts[0]).not.toBe(model.attempts[1]);
  for (const attempt of model.attempts) {
    expect(attempt.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: actor.sessionId } }));
    expect(attempt.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: target.id, facilityId: actor.facilityId } }));
    expect(attempt.role.findUnique).toHaveBeenCalledWith({ where: { code: "DATA_PROTECTION_OFFICER" } });
    expect(attempt.userRole.create).toHaveBeenCalledWith({ data: { userId: target.id, roleId: "dpo-role" } });
    expect(attempt.session.deleteMany).toHaveBeenCalledWith({ where: { userId: target.id } });
  }
  expect(model.saved.target.roles).toEqual([{ role: model.saved.selectedRole }]);
  expect(model.saved.sessions).toEqual([]);
  expect(model.saved.audits).toHaveLength(1);
  expect(model.saved.audits[0]).toMatchObject({ action: "STAFF_ACCESS_UPDATED", facilityId: actor.facilityId, userId: actor.id, sessionId: actor.sessionId, entityId: target.id });
  for (const attempt of vi.mocked(db.$transaction).mock.calls) expect(attempt[1]).toEqual({ isolationLevel: "Serializable" });
});
it.each(["role", "commit"] as const)("restarts the complete staff transaction after a known-aborted %s", async phase => {
  const model = stagedStaff([conflicts[0]], phase);
  expect((await reassign()).status).toBe(200);
  expect(model.attempts).toHaveLength(2);
  expect(model.saved.audits).toHaveLength(1);
  expect(model.saved.sessions).toEqual([]);
  expect(model.attempts[1].userRole.create).toHaveBeenCalledTimes(1);
});
it.each(conflicts)("exhausts three aborted staff attempts without modeled durable changes: %j", async conflict => {
  const model = stagedStaff([conflict, conflict, conflict]);
  const response = await reassign();
  expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty("user");
  expect(model.attempts).toHaveLength(3);
  expect(model.saved.target).toEqual(target); expect(model.saved.sessions).toEqual(["target-session"]); expect(model.saved.audits).toEqual([]);
});
it.each([{ code: "P2002" }, { code: "P2003" }, { code: "ECONNRESET" }, { code: "P2010", meta: { code: "08006" } }, new Error("Audit unavailable")])("does not replay staff changes after other failures: %j", async error => {
  const model = stagedStaff([error]);
  expect((await reassign()).status).toBe(["P2002", "P2003"].includes((error as { code?: string }).code || "") ? 409 : 500);
  expect(model.attempts).toHaveLength(1); expect(model.saved.audits).toEqual([]); expect(model.saved.sessions).toEqual(["target-session"]);
});

it.each(["target system administrator", "target missing", "selected role removed", "last administrator"])("rechecks %s from the fresh transaction after an abort", async guard => {
  const model = stagedStaff([conflicts[1]]);
  if (guard === "last administrator") {
    vi.mocked(requirePermission).mockResolvedValue({ ...actor, roles: ["SYSTEM_ADMIN"] } as any);
    model.saved.actorSession = actorSession(["SYSTEM_ADMIN"]);
    model.saved.target.roles = [{ role: { code: "SYSTEM_ADMIN" } }];
  }
  model.afterAbort(saved => {
    if (guard === "target system administrator") saved.target.roles = [{ role: { code: "SYSTEM_ADMIN" } }];
    if (guard === "target missing") saved.target = null;
    if (guard === "selected role removed") saved.selectedRole = null;
    if (guard === "last administrator") saved.adminCount = 1;
  });
  expect((await reassign()).status).toBe(guard === "target missing" ? 404 : guard === "selected role removed" ? 422 : guard === "last administrator" ? 409 : 403);
  expect(model.attempts).toHaveLength(2);
  expect(model.attempts[1].user.update).not.toHaveBeenCalled(); expect(model.attempts[1].session.deleteMany).not.toHaveBeenCalled(); expect(model.saved.audits).toEqual([]);
});
it("rejects self-disable without starting mutation or revoking the actor session", async () => {
  const model = stagedStaff(); model.saved.target.id = actor.id;
  expect((await reassign({ id: actor.id, status: "DISABLED" })).status).toBe(409);
  expect(model.attempts).toHaveLength(1);
  expect(model.attempts[0].userRole.deleteMany).not.toHaveBeenCalled(); expect(model.attempts[0].session.deleteMany).not.toHaveBeenCalled();
});
it("does not let HR overwrite a target promoted to governance after an aborted operational-role change", async () => {
  vi.mocked(requirePermission).mockResolvedValue({ ...actor, roles: ["HR_ADMIN"], permissions: ["admin.users"] } as any);
  const model = stagedStaff([conflicts[1]]);
  model.saved.actorSession = actorSession(["HR_ADMIN"], ["admin.users"]);
  model.saved.target.roles = [{ role: { code: "CLINICIAN" } }];
  model.saved.selectedRole = { id: "nurse-role", code: "NURSE" };
  model.afterAbort(saved => { saved.target.roles = [{ role: { code: "DATA_PROTECTION_OFFICER" } }]; });
  expect((await reassign({ roleCode: "NURSE" })).status).toBe(403);
  expect(model.attempts).toHaveLength(2);
  expect(model.attempts[0].role.findUnique).toHaveBeenCalledWith({ where: { code: "NURSE" } });
  expect(model.attempts[1].userRole.deleteMany).not.toHaveBeenCalled();
  expect(model.saved.sessions).toEqual(["target-session"]); expect(model.saved.audits).toEqual([]);
});
it.each(["session revoked", "admin permission removed", "governance permission removed", "MFA required", "MFA recovery required", "expired MFA challenge", "actor moved facility", "actor changed", "nested actor changed", "disabled actor", "expired session", "idle session", "temporary password"])("fails closed when %s between aborted staff attempts", async guard => {
  const model = stagedStaff([conflicts[1]]);
  model.afterAbort(saved => {
    const session = saved.actorSession;
    if (guard === "session revoked") saved.actorSession = null;
    if (guard === "admin permission removed") session.user.roles = [];
    if (guard === "governance permission removed") session.user.roles = actorSession(["HR_ADMIN"], ["admin.users"]).user.roles;
    if (guard === "MFA required") session.mfaVerifiedAt = null;
    if (guard === "MFA recovery required") { session.mfaVerifiedAt = null; session.user.mfaCredential = { enabledAt: null, recoveryRequired: true }; }
    if (guard === "expired MFA challenge") { session.mfaVerifiedAt = null; session.createdAt = new Date(Date.now() - 11 * 60_000); }
    if (guard === "actor moved facility") session.user.facilityId = "other-facility";
    if (guard === "actor changed") session.userId = "another-actor";
    if (guard === "nested actor changed") session.user.id = "another-actor";
    if (guard === "disabled actor") session.user.status = "DISABLED";
    if (guard === "expired session") session.expiresAt = new Date(0);
    if (guard === "idle session") session.lastSeenAt = new Date(0);
    if (guard === "temporary password") session.user.mustChangePassword = true;
  });
  const forbidden = ["admin permission removed", "governance permission removed", "MFA required", "MFA recovery required", "temporary password"].includes(guard);
  expect((await reassign()).status).toBe(forbidden ? 403 : 401);
  expect(model.attempts).toHaveLength(2);
  expect(model.attempts[1].user.update).not.toHaveBeenCalled(); expect(model.attempts[1].session.deleteMany).not.toHaveBeenCalled(); expect(model.saved.audits).toEqual([]);
});
it("allows existing verified MFA older than five minutes without inventing a new recency gate", async () => {
  const model = stagedStaff([conflicts[1]]);
  model.saved.actorSession.createdAt = new Date(Date.now() - 20 * 60_000);
  model.saved.actorSession.mfaVerifiedAt = new Date(Date.now() - 15 * 60_000);
  expect((await reassign()).status).toBe(200);
  expect(model.attempts).toHaveLength(2);
  expect(model.saved.sessions).toEqual([]); expect(model.saved.audits).toHaveLength(1);
});
