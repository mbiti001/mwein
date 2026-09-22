import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), cookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("./db", () => ({ db: { session: { findUnique: mocks.findUnique } } }));
import { currentUser, requirePermission } from "./auth";
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => { vi.stubEnv("MFA_REQUIRED", "true"); mocks.cookie.mockReturnValue({ value: "synthetic-session" }); });
function session(verified: boolean, enrolled: boolean) {
  return { id: "session", createdAt: new Date(), expiresAt: new Date(Date.now() + 600000), lastSeenAt: new Date(), mfaVerifiedAt: verified ? new Date() : null,
    user: { id: "staff", facilityId: "facility", email: "test@example.test", displayName: "Test staff", status: "ACTIVE", mustChangePassword: false,
      mfaCredential: enrolled ? { enabledAt: new Date() } : null, facility: { id: "facility", code: "TEST", name: "Test", timezone: "Africa/Nairobi" },
      roles: [{ role: { code: "CLINICIAN", permissions: [{ permission: { code: "visit.read" } }] } }],
    },
  };
}
describe("MFA access boundary", () => {
  it("withholds every operational permission before mandatory enrollment", async () => {
    mocks.findUnique.mockResolvedValue(session(false, false));
    expect(await currentUser()).toMatchObject({ mfaRequired: true, mfaEnrolled: false, permissions: [] });
    await expect(requirePermission("visit.read")).rejects.toMatchObject({ status: 403, code: "MFA_REQUIRED" });
  });
  it("requires verification of an enrolled factor even when rollout is optional", async () => {
    vi.stubEnv("MFA_REQUIRED", "false"); mocks.findUnique.mockResolvedValue(session(false, true));
    await expect(requirePermission("visit.read")).rejects.toMatchObject({ status: 403, code: "MFA_REQUIRED" });
  });
  it("keeps recovered accounts behind enrollment even if mandatory MFA is disabled", async () => {
    vi.stubEnv("MFA_REQUIRED", "false");
    const recovered = session(false, false);
    (recovered.user as any).mfaCredential = { enabledAt: null, recoveryRequired: true };
    mocks.findUnique.mockResolvedValue(recovered);
    expect(await currentUser()).toMatchObject({ mfaRequired: true, mfaEnrolled: false, permissions: [] });
    await expect(requirePermission("visit.read")).rejects.toMatchObject({ status: 403 });
  });
  it("grants only the assigned permissions after MFA", async () => {
    mocks.findUnique.mockResolvedValue(session(true, true));
    expect(await requirePermission("visit.read")).toMatchObject({ mfaRequired: false, permissions: ["visit.read"] });
    await expect(requirePermission("admin.users")).rejects.toMatchObject({ status: 403 });
  });
});
