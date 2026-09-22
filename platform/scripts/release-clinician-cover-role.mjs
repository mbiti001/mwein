import { PrismaClient } from "@prisma/client";
import { clinicianCoverRole as definition } from "./clinician-cover-role.mjs";
const db = new PrismaClient();
try {
  await db.$transaction(async tx => {
    const permissions = await tx.permission.findMany({ where: { code: { in: definition.grants } } });
    if (permissions.length !== definition.grants.length) throw new Error("Base permissions missing; refusing incomplete clinician cover role");
    const role = await tx.role.upsert({ where: { code: definition.code }, update: { name: definition.name }, create: { code: definition.code, name: definition.name, system: true } });
    await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: permissions.map(item => item.id) } } });
    for (const permission of permissions) await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
  });
  console.log("Clinician shortage cover role synchronized with 13 permissions; no users assigned or credentials changed.");
} finally { await db.$disconnect(); }
