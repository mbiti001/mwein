import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const roleCodes = ["RECEPTION", "NURSE", "CLINICIAN", "CLINICIAN_COVER", "MEDICAL_DIRECTOR"];
try {
  if (process.env.APPROVE_VITALS_ROLE_MAP !== "true") throw new Error("Review the vitals role map and set APPROVE_VITALS_ROLE_MAP=true to provision");
  await db.$transaction(async tx => {
    const roles = await tx.role.findMany({ where: { code: { in: roleCodes } } });
    if (roles.length !== roleCodes.length) throw new Error("Expected roles missing");
    const permission = await tx.permission.upsert({ where: { code: "vitals.write" }, update: {}, create: { code: "vitals.write", description: "Record measured vitals without completing clinical triage" } });
    await tx.rolePermission.deleteMany({ where: { permissionId: permission.id, roleId: { notIn: roles.map(role => role.id) } } });
    for (const role of roles) await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
  });
  console.log("Measured-vitals permission provisioned; no triage, diagnosis, prescribing or finance permissions added.");
} finally { await db.$disconnect(); }
