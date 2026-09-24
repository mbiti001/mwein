import { describe, expect, it } from "vitest";
import { canAssignRole, canManageStaff } from "./staff-access";

describe("staff role boundaries", () => {
  it("keeps system-administrator assignment exclusive to system administrators", () => {
    expect(canAssignRole({ actorRoles: ["FACILITY_ADMIN"], canAssignGovernance: true, roleCode: "SYSTEM_ADMIN" })).toBe(false);
    expect(canAssignRole({ actorRoles: ["SYSTEM_ADMIN"], canAssignGovernance: true, roleCode: "SYSTEM_ADMIN" })).toBe(true);
  });

  it("lets delegated facility governance assign governance roles", () => {
    expect(canAssignRole({ actorRoles: ["FACILITY_ADMIN"], canAssignGovernance: true, roleCode: "MEDICAL_DIRECTOR" })).toBe(true);
    expect(canAssignRole({ actorRoles: ["HR_ADMIN"], canAssignGovernance: false, roleCode: "FACILITY_ADMIN" })).toBe(false);
  });

  it("lets user administrators manage operational staff without escalating privilege", () => {
    expect(canAssignRole({ actorRoles: ["HR_ADMIN"], canAssignGovernance: false, roleCode: "PHARMACY_MANAGER" })).toBe(true);
    expect(canManageStaff({ actorRoles: ["HR_ADMIN"], canAssignGovernance: false, targetRoleCodes: ["FACILITY_ADMIN"] })).toBe(false);
    expect(canManageStaff({ actorRoles: ["HR_ADMIN"], canAssignGovernance: false, targetRoleCodes: ["PHARMACY"] })).toBe(true);
  });
});

describe("protected privacy and reporting appointments", () => {
  it.each(["DATA_PROTECTION_OFFICER", "REPORTING_OFFICER"])("requires governance authority to assign and manage %s", roleCode => {
    for (const allowed of [false, true]) {
      const actor = { actorRoles: ["HR_ADMIN"], canAssignGovernance: allowed };
      expect(canAssignRole({ ...actor, roleCode })).toBe(allowed);
      expect(canManageStaff({ ...actor, targetRoleCodes: ["RECEPTION", roleCode] })).toBe(allowed);
    }
  });
});
