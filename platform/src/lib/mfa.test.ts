import { afterEach, describe, expect, it, vi } from "vitest";
import { Secret, TOTP } from "otpauth";
import { acceptedMfaStep, authenticator, decryptMfaSecret, encryptMfaSecret, mfaFailure, newRecoveryCodes, recoveryHash, sessionNeedsMfa, workforceMfaRequired } from "./mfa";

afterEach(() => vi.unstubAllEnvs());
describe("workforce MFA", () => {
  it("requires MFA in production and always for enrolled accounts", () => {
    expect(workforceMfaRequired({ NODE_ENV: "production" })).toBe(true);
    expect(workforceMfaRequired({ NODE_ENV: "test" })).toBe(false);
    expect(sessionNeedsMfa(true, null, false)).toBe(true);
    expect(sessionNeedsMfa(false, null, true)).toBe(true);
    expect(sessionNeedsMfa(true, new Date(), true)).toBe(false);
  });
  it("matches the RFC 6238 SHA1 test vector and rejects replay", () => {
    const secret = Secret.fromUTF8("12345678901234567890").base32;
    expect(new TOTP({ secret, digits: 8 }).generate({ timestamp: 59000 })).toBe("94287082");
    expect(authenticator(secret).generate({ timestamp: 59000 })).toBe("287082");
    expect(acceptedMfaStep(secret, "287082", null, 59000)).toBe(1);
    expect(acceptedMfaStep(secret, "287082", 1, 59000)).toBeNull();
    expect(acceptedMfaStep(secret, "287082", null, 150000)).toBeNull();
    expect(acceptedMfaStep(secret, "12345", null, 59000)).toBeNull();
  });
  it("encrypts seeds with authenticated encryption bound to the account", () => {
    vi.stubEnv("AUTH_SECRET", "synthetic-test-secret-with-at-least-32-characters");
    const encrypted = encryptMfaSecret("EXAMPLESEED", "user-a");
    expect(encrypted).not.toContain("EXAMPLESEED");
    expect(decryptMfaSecret(encrypted, "user-a")).toBe("EXAMPLESEED");
    expect(() => decryptMfaSecret(encrypted, "user-b")).toThrow();
    expect(() => decryptMfaSecret(encrypted.slice(0, -2) + "zz", "user-a")).toThrow();
    expect(encryptMfaSecret("EXAMPLESEED", "user-a")).not.toBe(encrypted);
  });
  it("fails closed if the server encryption secret is absent", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => encryptMfaSecret("EXAMPLESEED", "user")).toThrow("not configured");
  });
  it("produces independent high-entropy recovery codes with account-bound hashes", () => {
    const { codes, hashes } = newRecoveryCodes("user-a");
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0].replaceAll("-", "")).toHaveLength(32);
    expect(hashes[0]).toBe(recoveryHash("user-a", codes[0].toLowerCase()));
    expect(hashes[0]).not.toBe(recoveryHash("user-b", codes[0]));
    expect(hashes).not.toContain(codes[0]);
  });
  it("locks after five failures and resets the attempt window after cooldown", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    const locked = mfaFailure({ failedAttempts: 4, attemptWindowAt: now }, now);
    expect(locked.failedAttempts).toBe(5);
    expect(locked.blockedUntil).toEqual(new Date("2026-09-22T12:15:00Z"));
    expect(mfaFailure({ failedAttempts: 5, attemptWindowAt: now }, new Date("2026-09-22T12:16:00Z")).failedAttempts).toBe(1);
  });
});
