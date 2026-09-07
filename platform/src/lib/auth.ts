import { cookies } from "next/headers";
import { db } from "./db";
import { hashToken } from "./security";

export const SESSION_COOKIE = "__Host-mwein_hmis_session";

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { facility: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } }
  });
  if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") return null;
  return {
    id: session.user.id,
    facilityId: session.user.facilityId,
    email: session.user.email,
    displayName: session.user.displayName,
    facility: { id: session.user.facility.id, code: session.user.facility.code, name: session.user.facility.name, timezone: session.user.facility.timezone },
    roles: session.user.roles.map(item => item.role.code),
    permissions: [...new Set(session.user.roles.flatMap(item => item.role.permissions.map(value => value.permission.code)))]
  };
}

export async function requirePermission(permission: string) {
  const user = await currentUser();
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (!user.permissions.includes(permission)) throw Object.assign(new Error("Permission denied"), { status: 403 });
  return user;
}
