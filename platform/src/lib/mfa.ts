import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { Secret, TOTP } from "otpauth";

export { MFA_CHALLENGE_MS, MFA_BLOCK_MS, MFA_MAX_FAILURES, workforceMfaRequired, sessionNeedsMfa } from "./mfa-policy";
import { MFA_BLOCK_MS, MFA_MAX_FAILURES } from "./mfa-policy";
function encryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("MFA encryption is not configured");
  return Buffer.from(hkdfSync("sha256", secret, "mwein-mfa-v1", "totp-secret-encryption", 32));
}
export function encryptMfaSecret(secret: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptMfaSecret(value: string, userId: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid MFA secret envelope");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
export const newMfaSecret = () => new Secret({ size: 20 }).base32;
export function authenticator(secret: string, label = "staff") {
  return new TOTP({ issuer: "Mwein HMIS", label, secret, algorithm: "SHA1", digits: 6, period: 30 });
}
export function acceptedMfaStep(secret: string, code: string, lastUsedStep: number | null, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator(secret).validate({ token: code, timestamp: now, window: 1 });
  const step = delta === null ? null : Math.floor(now / 30000) + delta;
  return step !== null && (lastUsedStep === null || step > lastUsedStep) ? step : null;
}
export function recoveryHash(userId: string, code: string) {
  return createHash("sha256").update(`mwein-mfa-recovery-v1:${userId}:${code.replace(/[\s-]/g, "").toUpperCase()}`).digest("hex");
}
export function newRecoveryCodes(userId: string) {
  const codes = Array.from({ length: 10 }, () => randomBytes(16).toString("hex").toUpperCase().match(/.{4}/g)!.join("-"));
  return { codes, hashes: codes.map(code => recoveryHash(userId, code)) };
}
export function mfaFailure(current: { failedAttempts: number; attemptWindowAt: Date }, now: Date) {
  const expired = now.getTime() - current.attemptWindowAt.getTime() >= MFA_BLOCK_MS;
  const failedAttempts = expired ? 1 : current.failedAttempts + 1;
  return { failedAttempts, attemptWindowAt: expired ? now : current.attemptWindowAt, blockedUntil: failedAttempts >= MFA_MAX_FAILURES ? new Date(now.getTime() + MFA_BLOCK_MS) : null };
}
