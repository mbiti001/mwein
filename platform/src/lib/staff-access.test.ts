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

describe("DPO governance boundary", () => {
  it("denies HR assignment and all management of DPO accounts", () => {
    const actor = { actorRoles: ["HR_ADMIN"], canAssignGovernance: false };
    expect(canAssignRole({ ...actor, roleCode: "DATA_PROTECTION_OFFICER" })).toBe(false);
    expect(canManageStaff({ ...actor, targetRoleCodes: ["DATA_PROTECTION_OFFICER"] })).toBe(false);
  });
  it("allows explicitly authorized governance administrators", () => {
    const actor = { actorRoles: ["FACILITY_ADMIN"], canAssignGovernance: true };
    expect(canAssignRole({ ...actor, roleCode: "DATA_PROTECTION_OFFICER" })).toBe(true);
    expect(canManageStaff({ ...actor, targetRoleCodes: ["DATA_PROTECTION_OFFICER"] })).toBe(true);
  });
});
