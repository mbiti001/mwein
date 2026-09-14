import { describe, expect, it } from "vitest";
import { roleScopedPermissions } from "./role-permissions";

describe("role-scoped permissions", () => {
  it("keeps a system-administrator-only account out of clinical records", () => {
    expect(
      roleScopedPermissions([
        {
          code: "SYSTEM_ADMIN",
          permissions: [
            "admin.dashboard",
            "admin.users",
            "audit.view",
            "patient.read",
            "visit.read",
            "encounter.write",
          ],
        },
      ]),
    ).toEqual(["admin.dashboard", "admin.users", "audit.view"]);
  });

  it("retains clinical access granted through a separate operational role", () => {
    expect(
      roleScopedPermissions([
        { code: "SYSTEM_ADMIN", permissions: ["admin.dashboard", "patient.read"] },
        { code: "CLINICIAN", permissions: ["patient.read", "visit.read", "encounter.write"] },
      ]),
    ).toEqual(["admin.dashboard", "patient.read", "visit.read", "encounter.write"]);
  });
});
