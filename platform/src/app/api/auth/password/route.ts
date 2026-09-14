import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/security";

const inputSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(16).max(256),
}).refine((value) => value.currentPassword !== value.newPassword, {
  path: ["newPassword"],
  message: "Choose a password that is different from the current password",
});

export async function POST(request: Request) {
  try {
    const actor = await currentUser();
    if (!actor) throw Object.assign(new Error("Authentication required"), { status: 401 });
    const input = inputSchema.parse(await request.json());
    const user = await db.user.findUnique({ where: { id: actor.id }, select: { passwordHash: true } });
    if (!user || !verifyPassword(input.currentPassword, user.passwordHash))
      throw Object.assign(new Error("The current password is incorrect"), { status: 401 });
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash: hashPassword(input.newPassword), mustChangePassword: false, passwordChangedAt: new Date() },
      });
      await tx.session.deleteMany({ where: { userId: actor.id, id: { not: actor.sessionId } } });
      await appendAudit(tx, {
        facilityId: actor.facilityId,
        userId: actor.id,
        sessionId: actor.sessionId,
        action: "PASSWORD_CHANGED",
        entityType: "User",
        entityId: actor.id,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
