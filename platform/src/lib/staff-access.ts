const governanceRoles = new Set(["FACILITY_ADMIN", "MEDICAL_DIRECTOR", "FINANCE_MANAGER", "HR_ADMIN", "AUDITOR", "DATA_PROTECTION_OFFICER", "REPORTING_OFFICER"]);

export function canAssignRole(input: { actorRoles: string[]; canAssignGovernance: boolean; roleCode: string }) {
  if (input.roleCode === "SYSTEM_ADMIN") return input.actorRoles.includes("SYSTEM_ADMIN");
  if (governanceRoles.has(input.roleCode)) return input.canAssignGovernance;
  return true;
}

export function canManageStaff(input: { actorRoles: string[]; canAssignGovernance: boolean; targetRoleCodes: string[] }) {
  if (input.targetRoleCodes.includes("SYSTEM_ADMIN")) return input.actorRoles.includes("SYSTEM_ADMIN");
  if (input.targetRoleCodes.some(code => governanceRoles.has(code))) return input.canAssignGovernance;
  return true;
}
