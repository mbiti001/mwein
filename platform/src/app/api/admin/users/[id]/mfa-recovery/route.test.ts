import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn(), SESSION_IDLE_MS: 1800000 }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn() } }));
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { POST } from "./route";
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor = { id: actorId, facilityId: "facility-a", sessionId: "session", permissions: ["admin.users", "admin.assign_governance"], roles: ["FACILITY_ADMIN"] };
const credentialWrite = vi.fn();
const sessionRead = vi.fn(), targetRead = vi.fn();
const request = () => new Request("http://localhost/", { method: "POST", body: JSON.stringify({ identityCheckReference: "TEST-EVIDENCE-REF", identityChecked: true, temporaryPassword: "Synthetic-password-2026!" }) });
const context = { params: Promise.resolve({ id }) };
function session() { return { userId: actorId, expiresAt: new Date(Date.now() + 600000), lastSeenAt: new Date(), mfaVerifiedAt: new Date(), user: { status: "ACTIVE", mustChangePassword: false, roles: [{ role: { code: "FACILITY_ADMIN", permissions: actor.permissions.map(code => ({ permission: { code } })) } }] } }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(requirePermission).mockResolvedValue(actor as any);
  sessionRead.mockResolvedValue(session());
  targetRead.mockResolvedValue({ id, status: "ACTIVE", roles: [{ role: { code: "CLINICIAN" } }], mfaCredential: { enabledAt: new Date() } });
  vi.mocked(db.$transaction).mockImplementation(async (fn: any) => fn({ session: { findUnique: sessionRead }, user: { findFirst: targetRead }, userMfa: { update: credentialWrite } }));
});
it("requires a separate administrator", async () => {
  expect((await POST(request(), { params: Promise.resolve({ id: actorId }) })).status).toBe(403);
  expect(db.$transaction).not.toHaveBeenCalled();
});
it.each([{ verifiedAt: null }, { verifiedAt: new Date(Date.now() - 360000) }])("requires recent MFA even in optional-enrollment environments", async ({ verifiedAt }) => {
  sessionRead.mockResolvedValue({ ...session(), mfaVerifiedAt: verifiedAt });
  expect((await POST(request(), context)).status).toBe(403); expect(credentialWrite).not.toHaveBeenCalled();
});
it("rejects revoked sessions", async () => {
  sessionRead.mockResolvedValue(null);
  expect((await POST(request(), context)).status).toBe(401); expect(credentialWrite).not.toHaveBeenCalled();
});
it("rechecks administrator rights inside the transaction", async () => {
  sessionRead.mockResolvedValue({ ...session(), user: { ...session().user, roles: [] } });
  expect((await POST(request(), context)).status).toBe(403); expect(credentialWrite).not.toHaveBeenCalled();
});
it("scopes target lookup to the actor facility", async () => {
  targetRead.mockResolvedValue(null);
  expect((await POST(request(), context)).status).toBe(404);
  expect(targetRead).toHaveBeenCalledWith(expect.objectContaining({ where: { id, facilityId: "facility-a" } }));
  expect(credentialWrite).not.toHaveBeenCalled();
});
it("does not let facility admins reset system admins", async () => {
  targetRead.mockResolvedValue({ id, status: "ACTIVE", roles: [{ role: { code: "SYSTEM_ADMIN" } }], mfaCredential: { enabledAt: new Date() } });
  expect((await POST(request(), context)).status).toBe(403); expect(credentialWrite).not.toHaveBeenCalled();
});
it("does not recover disabled accounts", async () => {
  targetRead.mockResolvedValue({ id, status: "DISABLED", roles: [], mfaCredential: { enabledAt: new Date() } });
  expect((await POST(request(), context)).status).toBe(409); expect(credentialWrite).not.toHaveBeenCalled();
});
