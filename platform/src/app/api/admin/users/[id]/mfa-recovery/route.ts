import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requirePermission, SESSION_IDLE_MS } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { apiError, privateJson } from "@/lib/http";
import { hashPassword } from "@/lib/security";
import { canManageStaff } from "@/lib/staff-access";

const inputSchema = z.object({
  identityCheckReference: z.string().trim().min(8).max(160),
  identityChecked: z.literal(true),
  temporaryPassword: z.string().min(16).max(256),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePermission("admin.assign_governance");
    if (!actor.permissions.includes("admin.users")) throw Object.assign(new Error("Staff administration is required"), { status: 403 });
    const id = z.uuid().parse((await context.params).id);
    if (id === actor.id) throw Object.assign(new Error("A different authorized administrator must recover this account"), { status: 403 });
    const input = inputSchema.parse(await request.json());
    await db.$transaction(async tx => {
      const now = new Date();
      const session = await tx.session.findUnique({ where: { id: actor.sessionId }, include: { user: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } } });
      if (!session || session.userId !== actor.id || session.user.status !== "ACTIVE" || session.user.mustChangePassword || session.expiresAt <= now || session.lastSeenAt.getTime() <= now.getTime() - SESSION_IDLE_MS)
        throw Object.assign(new Error("Sign in again before recovering staff access"), { status: 401 });
      if (!session.mfaVerifiedAt || session.mfaVerifiedAt.getTime() < now.getTime() - 5 * 60 * 1000)
        throw Object.assign(new Error("Sign out and complete a fresh MFA sign-in before recovering staff access (within five minutes)"), { status: 403 });
      const roles = session.user.roles.map(item => item.role.code);
      const permissions = session.user.roles.flatMap(item => item.role.permissions.map(grant => grant.permission.code));
      if (!permissions.includes("admin.assign_governance") || !permissions.includes("admin.users")) throw Object.assign(new Error("Permission denied"), { status: 403 });
      const target = await tx.user.findFirst({ where: { id, facilityId: actor.facilityId }, include: { roles: { include: { role: true } }, mfaCredential: true } });
      if (!target) throw Object.assign(new Error("Staff account not found"), { status: 404 });
      if (!canManageStaff({ actorRoles: roles, canAssignGovernance: true, targetRoleCodes: target.roles.map(item => item.role.code) })) throw Object.assign(new Error("Your role cannot recover this governance account"), { status: 403 });
      if (target.status !== "ACTIVE" || !target.mfaCredential?.enabledAt) throw Object.assign(new Error("Recovery requires an active account with an enrolled authenticator"), { status: 409 });
      // Clearing a lost factor must never turn a protected account into password-only access.
      await tx.userMfa.update({ where: { userId: id }, data: { recoveryRequired: true, secretCiphertext: null, pendingCiphertext: null, pendingSessionId: null, pendingExpiresAt: null, enabledAt: null, lastUsedStep: null, recoveryHashes: [], failedAttempts: 0, blockedUntil: null, attemptWindowAt: now } });
      await tx.user.update({ where: { id }, data: { passwordHash: hashPassword(input.temporaryPassword), mustChangePassword: true, passwordChangedAt: null } });
      await tx.session.deleteMany({ where: { userId: id } });
      await appendAudit(tx, { facilityId: actor.facilityId, userId: actor.id, sessionId: actor.sessionId, action: "MFA_ADMIN_RECOVERY", entityType: "User", entityId: id, reason: `Staff-attested identity check: ${input.identityCheckReference}` });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return privateJson({ ok: true, enrollmentRequired: true });
  } catch (error) { return apiError(error); }
}
