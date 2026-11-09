const governanceRoles = new Set(["FACILITY_ADMIN", "MEDICAL_DIRECTOR", "FINANCE_MANAGER", "HR_ADMIN", "AUDITOR", "DATA_PROTECTION_OFFICER"]);

export function canAssignRole(input: { actorRoles: string[]; canAssignGovernance: boolean; roleCode: string }) {
  if (input.roleCode === "SYSTEM_ADMIN") return input.actorRoles.includes("SYSTEM_ADMIN");
  if (governanceRoles.has(input.roleCode)) return input.canAssignGovernance;
  return true;
}

export function canManageStaff(input: { actorRoles: string[]; canAssignGovernance: boolean; targetRoleCodes: string[] }) {
  return input.targetRoleCodes.every(roleCode => canAssignRole({ ...input, roleCode }));
}
