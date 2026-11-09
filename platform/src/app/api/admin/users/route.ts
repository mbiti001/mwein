import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission, SESSION_IDLE_MS } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { apiError, privateJson } from "@/lib/http";
import { hashPassword } from "@/lib/security";
import { staffChangeIsSafe } from "@/lib/staff";
import { canAssignRole, canManageStaff } from "@/lib/staff-access";
import { MFA_CHALLENGE_MS, sessionNeedsMfa } from "@/lib/mfa-policy";
import { roleScopedPermissions } from "@/lib/role-permissions";
import { workflowTransaction } from "@/lib/workflow-transaction";

const roleCode = z.enum(["SYSTEM_ADMIN", "FACILITY_ADMIN", "MEDICAL_DIRECTOR", "FINANCE_MANAGER", "HR_ADMIN", "AUDITOR", "DATA_PROTECTION_OFFICER", "RECEPTION", "NURSE", "CLINICIAN", "CLINICIAN_COVER", "LABORATORY", "IMAGING", "PHARMACY", "PHARMACY_MANAGER", "BILLING"]);
const roleCodes = z.array(roleCode).min(1, "Select at least one role").max(roleCode.options.length)
  .refine(codes => new Set(codes).size === codes.length, "Select each role only once");
const assignment = { roleCodes: roleCodes.optional(), roleCode: roleCode.optional() };
type Assignment = { roleCodes?: z.infer<typeof roleCodes>; roleCode?: z.infer<typeof roleCode> };
function selection(input: Assignment) {
  return input.roleCodes ?? (input.roleCode ? [input.roleCode] : undefined);
}
const unambiguous = (input: Assignment) => !(input.roleCode && input.roleCodes);
const createSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.toLowerCase()),
  ...assignment,
  temporaryPassword: z.string().min(16).max(256),
}).refine(unambiguous, "Send only one role selection")
  .refine(input => selection(input)?.length, "Select at least one role");
const updateSchema = z.object({
  id: z.uuid(),
  ...assignment,
  previousRoleCodes: z.array(roleCode).max(roleCode.options.length).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  temporaryPassword: z.string().min(16).max(256).optional(),
}).refine(unambiguous, "Send only one role selection")
  .refine(input => selection(input) || input.status || input.temporaryPassword, "Choose a staff change");

async function selectedRoles(tx: Prisma.TransactionClient, user: {roles: string[]; permissions: string[]}, codes: string[]) {
  const access = { actorRoles: user.roles, canAssignGovernance: user.permissions.includes("admin.assign_governance") };
  if (!codes.every(roleCode => canAssignRole({ ...access, roleCode })))
    throw Object.assign(new Error("Your role cannot assign this governance level"), { status: 403 });
  const roles = await tx.role.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  if (roles.length !== codes.length) throw Object.assign(new Error("A selected staff role is not configured"), { status: 422 });
  return roles;
}
const orderedCodes = (codes: string[]) => [...codes].sort().join(",");

const staffInclude = { mfaCredential: { select: { enabledAt: true } }, roles: { include: { role: true } } } as const;

async function currentStaffActor(tx: Prisma.TransactionClient, actor: { id: string; sessionId: string; facilityId: string }) {
  // A retry must not reuse authority that was revoked while its first attempt aborted.
  const session = await tx.session.findUnique({ where: { id: actor.sessionId }, include: { user: { include: {
    mfaCredential: { select: { enabledAt: true, recoveryRequired: true } },
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  } } } });
  const now = new Date();
  if (!session || session.userId !== actor.id || session.user.id !== actor.id || session.user.facilityId !== actor.facilityId || session.user.status !== "ACTIVE" || session.expiresAt <= now || session.lastSeenAt.getTime() <= now.getTime() - SESSION_IDLE_MS)
    throw Object.assign(new Error("Authentication required"), { status: 401 });
  const mfaRequired = sessionNeedsMfa(Boolean(session.user.mfaCredential?.enabledAt || session.user.mfaCredential?.recoveryRequired), session.mfaVerifiedAt);
  if (mfaRequired && session.createdAt.getTime() < now.getTime() - MFA_CHALLENGE_MS)
    throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (session.user.mustChangePassword)
    throw Object.assign(new Error("Change your temporary password before continuing"), { status: 403, code: "PASSWORD_CHANGE_REQUIRED" });
  if (mfaRequired)
    throw Object.assign(new Error("Complete multi-factor authentication before continuing"), { status: 403, code: "MFA_REQUIRED" });
  const roles = session.user.roles.map(item => item.role.code);
  const permissions = roleScopedPermissions(session.user.roles.map(item => ({
    code: item.role.code, permissions: item.role.permissions.map(value => value.permission.code),
  })));
  if (!permissions.includes("admin.users")) throw Object.assign(new Error("Permission denied"), { status: 403 });
  return { id: session.user.id, sessionId: session.id, facilityId: session.user.facilityId, roles, permissions };
}

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
      users: users.map(({ passwordHash: _passwordHash, ...staff }) => ({ ...staff, self: staff.id === user.id, canRecoverMfa: staff.id !== user.id && staff.status === "ACTIVE" && Boolean(staff.mfaCredential?.enabledAt) && access.canAssignGovernance && canManageStaff({ ...access, targetRoleCodes: staff.roles.map(item => item.role.code) }), manageable: canManageStaff({ ...access, targetRoleCodes: staff.roles.map(item => item.role.code) }) })),
      roles: roles.map(role => ({ ...role, assignable: canAssignRole({ ...access, roleCode: role.code }) })),
    });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requirePermission("admin.users");
    const input = createSchema.parse(await request.json());
    const requested = selection(input)!;
    const created = await workflowTransaction(async (tx) => {
      const user = await currentStaffActor(tx, actor);
      const roles = await selectedRoles(tx, user, requested);
      const staff = await tx.user.create({ data: {
        facilityId: user.facilityId,
        displayName: input.displayName,
        email: input.email,
        passwordHash: hashPassword(input.temporaryPassword),
        mustChangePassword: true,
        roles: { create: roles.map(role => ({ roleId: role.id })) },
      }, include: staffInclude });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "STAFF_CREATED", entityType: "User", entityId: staff.id, afterHash: `${staff.email}:${orderedCodes(requested)}` });
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
    const actor = await requirePermission("admin.users");
    const input = updateSchema.parse(await request.json());
    const updated = await workflowTransaction(async (tx) => {
      const user = await currentStaffActor(tx, actor);
      const target = await tx.user.findFirst({ where: { id: input.id, facilityId: user.facilityId }, include: staffInclude });
      if (!target) throw Object.assign(new Error("Staff account not found"), { status: 404 });
      const access = { actorRoles: user.roles, canAssignGovernance: user.permissions.includes("admin.assign_governance") };
      if (!canManageStaff({ ...access, targetRoleCodes: target.roles.map(item => item.role.code) }))
        throw Object.assign(new Error("Your role cannot change this governance account"), { status: 403 });
      const current = target.roles.map(item => item.role.code);
      const requested = selection(input);
      if (input.roleCode && current.length > 1)
        throw Object.assign(new Error("This account has multiple roles. Reopen Staff access to edit its full selection."), { status: 409 });
      if (input.previousRoleCodes && orderedCodes(current) !== orderedCodes(input.previousRoleCodes))
        throw Object.assign(new Error("The assigned roles have changed. Refresh staff and review the current selection."), { status: 409 });
      if (target.id === user.id && requested?.some(code => !current.includes(code)))
        throw Object.assign(new Error("Another authorised administrator must grant new roles to your account"), { status: 403 });
      const roles = requested ? await selectedRoles(tx, user, requested) : undefined;
      const targetIsAdmin = target.status === "ACTIVE" && current.includes("SYSTEM_ADMIN");
      const activeAdminCount = targetIsAdmin ? await tx.user.count({ where: { facilityId: user.facilityId, status: "ACTIVE", roles: { some: { role: { code: "SYSTEM_ADMIN" } } } } }) : 0;
      const safety = staffChangeIsSafe({ targetUserId: target.id, actingUserId: user.id, targetIsAdmin, activeAdminCount, nextStatus: input.status, nextRoleCodes: requested });
      if (!safety.safe) throw Object.assign(new Error(safety.reason), { status: 409 });

      if (roles) {
        await tx.userRole.deleteMany({ where: { userId: target.id, roleId: { notIn: roles.map(role => role.id) } } });
        await tx.userRole.createMany({ data: roles.map(role => ({ userId: target.id, roleId: role.id })), skipDuplicates: true });
      }
      const staff = await tx.user.update({ where: { id: target.id }, data: {
        status: input.status,
        passwordHash: input.temporaryPassword ? hashPassword(input.temporaryPassword) : undefined,
        mustChangePassword: input.temporaryPassword ? true : undefined,
        passwordChangedAt: input.temporaryPassword ? null : undefined,
      }, include: staffInclude });
      if (input.status || requested || input.temporaryPassword)
        await tx.session.deleteMany({ where: { userId: target.id } });
      await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: input.temporaryPassword ? "STAFF_PASSWORD_RESET" : "STAFF_ACCESS_UPDATED", entityType: "User", entityId: target.id, beforeHash: `${target.status}:${orderedCodes(current)}`, afterHash: `${staff.status}:${orderedCodes(staff.roles.map(item => item.role.code))}` });
      return staff;
    });
    const { passwordHash: _passwordHash, ...safeStaff } = updated;
    return privateJson({ user: safeStaff });
  } catch (error) { return apiError(error); }
}
