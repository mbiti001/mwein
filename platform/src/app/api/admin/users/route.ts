import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { apiError, privateJson } from "@/lib/http";
import { hashPassword } from "@/lib/security";
import { staffChangeIsSafe } from "@/lib/staff";
import { canAssignRole, canManageStaff } from "@/lib/staff-access";

const roleCode = z.enum(["SYSTEM_ADMIN", "FACILITY_ADMIN", "MEDICAL_DIRECTOR", "FINANCE_MANAGER", "HR_ADMIN", "AUDITOR", "DATA_PROTECTION_OFFICER", "RECEPTION", "NURSE", "CLINICIAN", "CLINICIAN_COVER", "LABORATORY", "IMAGING", "PHARMACY", "PHARMACY_MANAGER", "BILLING"]);
const createSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.toLowerCase()),
  roleCode,
  temporaryPassword: z.string().min(16).max(256),
});
const updateSchema = z.object({
  id: z.uuid(),
  roleCode: roleCode.optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  temporaryPassword: z.string().min(16).max(256).optional(),
}).refine((value) => value.roleCode || value.status || value.temporaryPassword, "Choose a staff change");

const staffInclude = { mfaCredential: { select: { enabledAt: true } }, roles: { include: { role: true } } } as const;

export async function GET() {
  try {
    const user = await requirePermission("admin.users");
    const [users, roles] = await Promise.all([
      db.user.findMany({ where: { facilityId: user.facilityId }, include: staffInclude, orderBy: { displayName: "asc" } }),
      db.role.findMany({ where: { code: { in: roleCode.options } }, include: { permissions: { include: { permission: { select: { code: true, description: true } } } } }, orderBy: { name: "asc" } }),
    ]);
    const access = { actorRoles: user.roles, canAssignGovernance: user.permissions.includes("admin.assign_governance") };
    await recordDisclosure(user, "STAFF_ACCESS", users.map(staff => staff.id));
    return privateJson({
      users: users.map(({ passwordHash: _passwordHash, ...staff }) => ({ ...staff, canRecoverMfa: staff.id !== user.id && staff.status === "ACTIVE" && Boolean(staff.mfaCredential?.enabledAt) && access.canAssignGovernance && canManageStaff({ ...access, targetRoleCodes: staff.roles.map(item => item.role.code) }), manageable: canManageStaff({ ...access, targetRoleCodes: staff.roles.map(item => item.role.code) }) })),
      roles: roles.map(role => ({ ...role, assignable: canAssignRole({ ...access, roleCode: role.code }) })),
    });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("admin.users");
    const input = createSchema.parse(await request.json());
    if (!canAssignRole({ actorRoles: user.roles, canAssignGovernance: user.permissions.includes("admin.assign_governance"), roleCode: input.roleCode }))
      throw Object.assign(new Error("Your role cannot assign this governance level"), { status: 403 });
    const role = await db.role.findUnique({ where: { code: input.roleCode } });
    if (!role) throw Object.assign(new Error("Selected staff role is not configured"), { status: 422 });
    const created = await db.$transaction(async (tx) => {
      const staff = await tx.user.create({ data: {
        facilityId: user.facilityId,
        displayName: input.displayName,
        email: input.email,
        passwordHash: hashPassword(input.temporaryPassword),
        mustChangePassword: true,
        roles: { create: { roleId: role.id } },
      }, include: staffInclude });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "STAFF_CREATED", entityType: "User", entityId: staff.id, afterHash: `${staff.email}:${input.roleCode}` });
      return staff;
    });
    const { passwordHash: _passwordHash, ...safeStaff } = created;
    return privateJson({ user: safeStaff }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return privateJson({ error: "A staff account with this email already exists" }, { status: 409 });
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requirePermission("admin.users");
    const input = updateSchema.parse(await request.json());
    const target = await db.user.findFirst({ where: { id: input.id, facilityId: user.facilityId }, include: staffInclude });
    if (!target) throw Object.assign(new Error("Staff account not found"), { status: 404 });
    const access = { actorRoles: user.roles, canAssignGovernance: user.permissions.includes("admin.assign_governance") };
    if (!canManageStaff({ ...access, targetRoleCodes: target.roles.map(item => item.role.code) }))
      throw Object.assign(new Error("Your role cannot change this governance account"), { status: 403 });
    if (input.roleCode && !canAssignRole({ ...access, roleCode: input.roleCode }))
      throw Object.assign(new Error("Your role cannot assign this governance level"), { status: 403 });
    const targetIsAdmin = target.roles.some((item) => item.role.code === "SYSTEM_ADMIN");
    const activeAdminCount = await db.user.count({ where: { facilityId: user.facilityId, status: "ACTIVE", roles: { some: { role: { code: "SYSTEM_ADMIN" } } } } });
    const safety = staffChangeIsSafe({ targetUserId: target.id, actingUserId: user.id, targetIsAdmin, activeAdminCount, nextStatus: input.status, nextRoleCode: input.roleCode });
    if (!safety.safe) throw Object.assign(new Error(safety.reason), { status: 409 });
    const role = input.roleCode ? await db.role.findUnique({ where: { code: input.roleCode } }) : null;
    if (input.roleCode && !role) throw Object.assign(new Error("Selected staff role is not configured"), { status: 422 });

    const updated = await db.$transaction(async (tx) => {
      if (role) {
        await tx.userRole.deleteMany({ where: { userId: target.id } });
        await tx.userRole.create({ data: { userId: target.id, roleId: role.id } });
      }
      const staff = await tx.user.update({ where: { id: target.id }, data: {
        status: input.status,
        passwordHash: input.temporaryPassword ? hashPassword(input.temporaryPassword) : undefined,
        mustChangePassword: input.temporaryPassword ? true : undefined,
        passwordChangedAt: input.temporaryPassword ? null : undefined,
      }, include: staffInclude });
      if (input.status || input.roleCode || input.temporaryPassword)
        await tx.session.deleteMany({ where: { userId: target.id } });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: input.temporaryPassword ? "STAFF_PASSWORD_RESET" : "STAFF_ACCESS_UPDATED", entityType: "User", entityId: target.id, beforeHash: `${target.status}:${target.roles.map((item) => item.role.code).join(",")}`, afterHash: `${staff.status}:${staff.roles.map((item) => item.role.code).join(",")}` });
      return staff;
    });
    const { passwordHash: _passwordHash, ...safeStaff } = updated;
    return privateJson({ user: safeStaff });
  } catch (error) { return apiError(error); }
}
