type RoleGrant = {
  code: string;
  permissions: string[];
};

const systemAdministrationPermissions = new Set([
  "admin.users",
  "admin.assign_governance",
  "admin.catalog",
  "admin.dashboard",
  "audit.view",
]);

export function roleScopedPermissions(roles: RoleGrant[]) {
  const permissions = roles.flatMap((role) =>
    role.code === "SYSTEM_ADMIN"
      ? role.permissions.filter((permission) =>
          systemAdministrationPermissions.has(permission),
        )
      : role.permissions,
  );
  return [...new Set(permissions)];
}
