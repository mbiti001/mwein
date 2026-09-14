import { cookies } from "next/headers";
import { db } from "./db";
import { hashToken } from "./security";
import { roleScopedPermissions } from "./role-permissions";

export const SESSION_COOKIE = "__Host-mwein_hmis_session";
export const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_TOUCH_MS = 5 * 60 * 1000;

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { facility: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } }
  });
  const now = new Date();
  if (!session || session.expiresAt <= now || session.user.status !== "ACTIVE") return null;
  if (session.lastSeenAt.getTime() <= now.getTime() - SESSION_IDLE_MS) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (session.lastSeenAt.getTime() <= now.getTime() - SESSION_TOUCH_MS)
    await db.session.updateMany({ where: { id: session.id, lastSeenAt: session.lastSeenAt }, data: { lastSeenAt: now } });
  const roles = session.user.roles.map((item) => item.role.code);
  const permissions = roleScopedPermissions(
    session.user.roles.map((item) => ({
      code: item.role.code,
      permissions: item.role.permissions.map((value) => value.permission.code),
    })),
  );
  return {
    id: session.user.id,
    sessionId: session.id,
    facilityId: session.user.facilityId,
    email: session.user.email,
    displayName: session.user.displayName,
    mustChangePassword: session.user.mustChangePassword,
    facility: { id: session.user.facility.id, code: session.user.facility.code, name: session.user.facility.name, timezone: session.user.facility.timezone },
    roles,
    permissions,
  };
}

export async function requirePermission(permission: string) {
  const user = await currentUser();
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (user.mustChangePassword) throw Object.assign(new Error("Change your temporary password before continuing"), { status: 403, code: "PASSWORD_CHANGE_REQUIRED" });
  if (!user.permissions.includes(permission)) throw Object.assign(new Error("Permission denied"), { status: 403 });
  return user;
}
