import { PrismaClient } from "@prisma/client";
const grants = {
  "surveillance.read": ["NURSE", "CLINICIAN", "CLINICIAN_COVER", "MEDICAL_DIRECTOR"],
  "surveillance.record": ["NURSE", "CLINICIAN", "CLINICIAN_COVER", "MEDICAL_DIRECTOR"],
  "surveillance.review": ["MEDICAL_DIRECTOR"],
};
const db = new PrismaClient();
try {
  if (process.env.APPROVE_SURVEILLANCE_ROLE_MAP !== "true") throw new Error("Review the surveillance role map and set APPROVE_SURVEILLANCE_ROLE_MAP=true to provision");
  await db.$transaction(async tx => {
    for (const [code, roleCodes] of Object.entries(grants)) {
      const roles = await tx.role.findMany({ where: { code: { in: roleCodes } } });
      if (roles.length !== roleCodes.length) throw new Error("Expected surveillance roles missing");
      const permission = await tx.permission.upsert({ where: { code }, update: {}, create: { code, description: code === "surveillance.read" ? "View local surveillance records" : code === "surveillance.record" ? "Capture local surveillance and manual notification history" : "Review and close local surveillance concerns" } });
      await tx.rolePermission.deleteMany({ where: { permissionId: permission.id, roleId: { notIn: roles.map(role => role.id) } } });
      for (const role of roles) await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
    }
  });
  console.log("Surveillance role definitions synchronized. No user assignments or credentials changed.");
} finally { await db.$disconnect(); }
