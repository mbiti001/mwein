import { PrismaClient } from "@prisma/client";

// Explicit role map, reviewed before release. No grant is inferred from billing.read.
const grants = { "reports.clinical": ["FACILITY_ADMIN", "MEDICAL_DIRECTOR"], "reports.operations": ["FACILITY_ADMIN", "FINANCE_MANAGER", "AUDITOR"] };
const db = new PrismaClient();
try {
  if (process.env.APPROVE_REPORT_ROLE_MAP !== "true") throw new Error("Review the documented reporting role map and set APPROVE_REPORT_ROLE_MAP=true to provision");
  await db.$transaction(async tx => {
    for (const [code, roleCodes] of Object.entries(grants)) {
      const roles = await tx.role.findMany({ where: { code: { in: roleCodes } } });
      if (roles.length !== roleCodes.length) throw new Error("Expected roles missing; refusing incomplete provisioning");
      const permission = await tx.permission.upsert({ where: { code }, update: {}, create: { code, description: code === "reports.clinical" ? "View facility clinical source reports" : "View facility operational reports" } });
      await tx.rolePermission.deleteMany({ where: { permissionId: permission.id, roleId: { notIn: roles.map(role => role.id) } } });
      for (const role of roles) await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
    }
  });
  console.log("Reviewed reporting role definitions synchronized; no users assigned or credentials changed.");
} finally { await db.$disconnect(); }
