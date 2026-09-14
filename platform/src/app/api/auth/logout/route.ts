import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { hashToken } from "@/lib/security";
import { appendAudit } from "@/lib/audit";
import { currentUser } from "@/lib/auth";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const actor = token ? await currentUser() : null;
  if (token) await db.$transaction(async (tx) => {
    if (actor) await appendAudit(tx, {
      facilityId: actor.facilityId,
      userId: actor.id,
      sessionId: actor.sessionId,
      action: "LOGOUT",
      entityType: "Session",
      entityId: actor.sessionId,
    });
    await tx.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  });
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
