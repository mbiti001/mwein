import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import QRCode from "qrcode";
import { currentUser, SESSION_COOKIE } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { hashToken, newSessionToken, verifyPassword } from "@/lib/security";
import { acceptedMfaStep, authenticator, decryptMfaSecret, encryptMfaSecret, mfaFailure, MFA_CHALLENGE_MS, newMfaSecret, newRecoveryCodes, recoveryHash } from "@/lib/mfa";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START"), password: z.string().min(1).max(256) }),
  z.object({ action: z.literal("CONFIRM"), code: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("VERIFY"), code: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("REPLACE"), password: z.string().min(1).max(256), code: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("RECOVERY_CODES"), password: z.string().min(1).max(256), code: z.string().trim().min(1).max(80) }),
]);
const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const actor = await currentUser();
    if (!actor) throw Object.assign(new Error("Sign in again to manage MFA"), { status: 401 });
    const mfa = await db.userMfa.findUnique({ where: { userId: actor.id }, select: { enabledAt: true, recoveryHashes: true } });
    return NextResponse.json({ enrolled: Boolean(mfa?.enabledAt), required: actor.mfaRequired, recoveryCodesRemaining: mfa?.recoveryHashes.length || 0 }, { headers: noStore });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await currentUser();
    if (!actor) throw Object.assign(new Error("Sign in again to continue MFA"), { status: 401 });
    const input = inputSchema.parse(await request.json());
    const token = newSessionToken();
    const run = () => db.$transaction(async tx => {
      const now = new Date();
      // Recheck the session in the same serializable transaction as factor use.
      const session = await tx.session.findUnique({ where: { id: actor.sessionId }, include: { user: true } });
      if (!session || session.user.status !== "ACTIVE" || session.expiresAt <= now || session.userId !== actor.id)
        throw Object.assign(new Error("Sign in again to continue MFA"), { status: 401 });
      if (!session.mfaVerifiedAt && session.createdAt.getTime() < now.getTime() - MFA_CHALLENGE_MS)
        throw Object.assign(new Error("Your verification session expired. Sign out and sign in again."), { status: 401 });
      if (session.user.mustChangePassword && input.action !== "VERIFY")
        throw Object.assign(new Error("Change your temporary password before setting up MFA"), { status: 403 });
      const mfa = await tx.userMfa.upsert({ where: { userId: actor.id }, update: {}, create: { userId: actor.id } });
      if (mfa.blockedUntil && mfa.blockedUntil > now)
        return { error: "Too many failed verification attempts. Wait 15 minutes before trying again.", status: 429 as const };
      const fail = async () => {
        const failure = mfaFailure(mfa, now);
        await tx.userMfa.update({ where: { userId: actor.id }, data: failure });
        await appendAudit(tx, { facilityId: actor.facilityId, userId: actor.id, sessionId: session.id, action: "MFA_VERIFICATION_FAILED", entityType: "User", entityId: actor.id, reason: input.action });
        return { error: failure.blockedUntil ? "Too many failed verification attempts. Wait 15 minutes before trying again." : "Verification failed. Check your password or code; used codes cannot be reused.", status: failure.blockedUntil ? 429 as const : 401 as const };
      };
      if ("password" in input && !verifyPassword(input.password, session.user.passwordHash)) return fail();
      let usedRecovery = false;
      if (["VERIFY", "REPLACE", "RECOVERY_CODES"].includes(input.action)) {
        if (!mfa.enabledAt || !mfa.secretCiphertext) throw Object.assign(new Error("Set up your authenticator first"), { status: 409 });
        if (input.action === "VERIFY" && session.mfaVerifiedAt) throw Object.assign(new Error("This session has already completed MFA"), { status: 409 });
        const code = "code" in input ? input.code : "";
        const step = acceptedMfaStep(decryptMfaSecret(mfa.secretCiphertext, actor.id), code, mfa.lastUsedStep, now.getTime());
        const hash = recoveryHash(actor.id, code);
        usedRecovery = mfa.recoveryHashes.includes(hash);
        if (step === null && !usedRecovery) return fail();
        await tx.userMfa.update({ where: { userId: actor.id }, data: step !== null ? { lastUsedStep: step } : { recoveryHashes: mfa.recoveryHashes.filter(item => item !== hash) } });
      }
      if (input.action === "START" || input.action === "REPLACE") {
        if (input.action === "START" && mfa.enabledAt) throw Object.assign(new Error("Use the protected authenticator replacement flow"), { status: 409 });
        const secret = newMfaSecret();
        await tx.userMfa.update({ where: { userId: actor.id }, data: { pendingCiphertext: encryptMfaSecret(secret, actor.id), pendingSessionId: session.id, pendingExpiresAt: new Date(now.getTime() + MFA_CHALLENGE_MS) } });
        await appendAudit(tx, { facilityId: actor.facilityId, userId: actor.id, sessionId: session.id, action: "MFA_ENROLLMENT_STARTED", entityType: "User", entityId: actor.id, reason: input.action });
        return { setup: { secret, uri: authenticator(secret, `${actor.facility.code}:${actor.email}`).toString() } };
      }
      let recoveryCodes: string[] | undefined;
      if (input.action === "CONFIRM") {
        if (!mfa.pendingCiphertext || mfa.pendingSessionId !== session.id || !mfa.pendingExpiresAt || mfa.pendingExpiresAt <= now)
          throw Object.assign(new Error("Setup expired or belongs to another sign-in. Start setup again."), { status: 409 });
        const secret = decryptMfaSecret(mfa.pendingCiphertext, actor.id);
        const step = acceptedMfaStep(secret, input.code, null, now.getTime());
        if (step === null) return fail();
        const recovery = newRecoveryCodes(actor.id);
        recoveryCodes = recovery.codes;
        await tx.userMfa.update({ where: { userId: actor.id }, data: { recoveryRequired: false, secretCiphertext: mfa.pendingCiphertext, enabledAt: now, lastUsedStep: step, recoveryHashes: recovery.hashes, pendingCiphertext: null, pendingSessionId: null, pendingExpiresAt: null } });
      }
      if (input.action === "RECOVERY_CODES") {
        const recovery = newRecoveryCodes(actor.id);
        recoveryCodes = recovery.codes;
        await tx.userMfa.update({ where: { userId: actor.id }, data: { recoveryHashes: recovery.hashes } });
      }
      await tx.userMfa.update({ where: { userId: actor.id }, data: { failedAttempts: 0, blockedUntil: null, attemptWindowAt: now } });
      // Rotate the password-stage token. Enrollment/recovery also revokes other sessions.
      await tx.session.deleteMany({ where: { userId: actor.id, ...(input.action === "VERIFY" && !usedRecovery ? { id: session.id } : {}) } });
      const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const verified = await tx.session.create({ data: { userId: actor.id, tokenHash: hashToken(token), expiresAt, mfaVerifiedAt: now, ipHash: session.ipHash, userAgent: session.userAgent } });
      await appendAudit(tx, { facilityId: actor.facilityId, userId: actor.id, sessionId: verified.id, action: input.action === "CONFIRM" ? "MFA_ENROLLED" : input.action === "RECOVERY_CODES" ? "MFA_RECOVERY_CODES_REGENERATED" : "MFA_VERIFIED", entityType: "User", entityId: actor.id, reason: usedRecovery ? "RECOVERY_CODE" : "AUTHENTICATOR" });
      return { verified: true, expiresAt, recoveryCodes };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    let result: Awaited<ReturnType<typeof run>> | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { result = await run(); break; }
      catch (error) { if ((error as { code?: string }).code !== "P2034" || attempt === 2) throw error; }
    }
    if (!result) throw new Error("MFA transaction did not complete");
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status, headers: noStore });
    if ("setup" in result && result.setup) return NextResponse.json({ secret: result.setup.secret, qrCode: await QRCode.toDataURL(result.setup.uri, { width: 240, margin: 2 }) }, { headers: noStore });
    if ("verified" in result && result.verified) {
      (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: result.expiresAt });
      return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes }, { headers: noStore });
    }
    throw new Error("Unknown MFA result");
  } catch (error) { return apiError(error); }
}
