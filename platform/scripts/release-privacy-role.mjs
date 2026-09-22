import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
try {
  await db.$transaction(async tx => {
    const permission = await tx.permission.upsert({ where: { code: "privacy.manage" }, update: {}, create: { code: "privacy.manage", description: "Manage patient consent and data-subject requests" } });
    const role = await tx.role.upsert({ where: { code: "DATA_PROTECTION_OFFICER" }, update: {}, create: { code: "DATA_PROTECTION_OFFICER", name: "Data protection officer", system: true } });
    const grants = await tx.permission.findMany({ where: { code: { in: ["patient.read", "admin.dashboard", "audit.view"] } } });
    if (grants.length !== 3) throw new Error("Existing base permissions are missing; refusing incomplete role provisioning");
    for (const grant of [permission, ...grants]) await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: grant.id } }, update: {}, create: { roleId: role.id, permissionId: grant.id } });
  });
  console.log("Privacy role definition synchronized; no users assigned or credentials changed.");
} finally { await db.$disconnect(); }
