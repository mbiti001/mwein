import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import {
  LOGIN_BLOCK_MS,
  loginThrottleIdentity,
  nextLoginFailure,
  requestIpHash,
} from "@/lib/login-security";
import { hashPassword, hashToken, newSessionToken, verifyPassword } from "@/lib/security";
import { currentUser, SESSION_COOKIE } from "@/lib/auth";
import { workforceMfaRequired, MFA_CHALLENGE_MS } from "@/lib/mfa";

const inputSchema = z.object({
  facilityCode: z.string().trim().min(2).max(30).transform((value) => value.toUpperCase()),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(256),
});
const DUMMY_PASSWORD_HASH = hashPassword("Mwein-invalid-account-password-placeholder");

async function recordFailure(input: {
  key: string;
  facilityId?: string;
  emailHash: string;
  ipHash: string;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const current = await tx.loginThrottle.findUnique({ where: { key: input.key } });
        const next = nextLoginFailure(current);
        return tx.loginThrottle.upsert({
          where: { key: input.key },
          update: { ...next, facilityId: input.facilityId, emailHash: input.emailHash, ipHash: input.ipHash },
          create: { ...input, ...next, facilityId: input.facilityId },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034" || attempt === 2) throw error;
    }
  }
}

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const ipHash = requestIpHash(request);
    const identity = loginThrottleIdentity(input.facilityCode, input.email, ipHash);
    const throttle = await db.loginThrottle.findUnique({ where: { key: identity.key } });
    if (throttle?.blockedUntil && throttle.blockedUntil > new Date()) {
      const retryAfter = Math.max(1, Math.ceil((throttle.blockedUntil.getTime() - Date.now()) / 1000));
      return NextResponse.json(
        { error: "Too many sign-in attempts", reason: "Wait before trying again or contact an administrator." },
        { status: 429, headers: { "retry-after": String(retryAfter) } },
      );
    }

    const facility = await db.facility.findUnique({ where: { code: input.facilityCode } });
    const user = facility ? await db.user.findUnique({
      where: { facilityId_email: { facilityId: facility.id, email: input.email } },
      include: { mfaCredential: { select: { enabledAt: true, recoveryRequired: true } }, facility: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    }) : null;
    const passwordMatches = verifyPassword(input.password, user?.passwordHash || DUMMY_PASSWORD_HASH);
    if (!user || user.status !== "ACTIVE" || !passwordMatches) {
      const failure = await recordFailure({
        key: identity.key,
        facilityId: facility?.id,
        emailHash: identity.emailHash,
        ipHash,
      });
      if (user && facility) {
        await db.$transaction(async (tx) => appendAudit(tx, {
          facilityId: facility.id,
          userId: user.id,
          action: "LOGIN_FAILED",
          entityType: "User",
          entityId: user.id,
          reason: user.status === "ACTIVE" ? "INVALID_CREDENTIALS" : `ACCOUNT_${user.status}`,
        }));
      }
      const blocked = failure?.blockedUntil && failure.blockedUntil > new Date();
      return NextResponse.json(
        blocked
          ? { error: "Too many sign-in attempts", reason: "Wait before trying again or contact an administrator." }
          : { error: "The facility code, email, or password is incorrect" },
        { status: blocked ? 429 : 401, ...(blocked ? { headers: { "retry-after": String(LOGIN_BLOCK_MS / 1000) } } : {}) },
      );
    }

    const token = newSessionToken();
    const mfaRequired = workforceMfaRequired() || Boolean(user.mfaCredential?.enabledAt || user.mfaCredential?.recoveryRequired);
    const expiresAt = new Date(Date.now() + (mfaRequired ? MFA_CHALLENGE_MS : 8 * 60 * 60 * 1000));
    await db.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt, ipHash, userAgent: request.headers.get("user-agent")?.slice(0, 300) },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await appendAudit(tx, {
        facilityId: user.facilityId,
        userId: user.id,
        sessionId: created.id,
        action: mfaRequired ? "LOGIN_PASSWORD_VERIFIED" : "LOGIN_SUCCEEDED",
        entityType: "Session",
        entityId: created.id,
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await db.loginThrottle.deleteMany({ where: { key: identity.key } });
    (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: expiresAt });
    return NextResponse.json({ user: await currentUser(), expiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
