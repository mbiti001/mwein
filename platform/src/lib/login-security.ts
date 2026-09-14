import { createHmac } from "node:crypto";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;

export function applicationSecret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production")
    throw new Error("AUTH_SECRET must be configured with at least 32 characters");
  return "mwein-local-development-secret-not-for-production";
}

export function privateFingerprint(purpose: string, value: string) {
  return createHmac("sha256", applicationSecret()).update(`${purpose}\u001f${value}`).digest("hex");
}

export function requestIpHash(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return privateFingerprint("client-ip", address);
}

export function loginThrottleIdentity(facilityCode: string, email: string, ipHash: string) {
  const normalized = `${facilityCode.trim().toUpperCase()}\u001f${email.trim().toLowerCase()}\u001f${ipHash}`;
  return {
    key: privateFingerprint("login-throttle", normalized),
    emailHash: privateFingerprint("login-email", email.trim().toLowerCase()),
  };
}

export function nextLoginFailure(current: { failedCount: number; windowStartedAt: Date } | null, now = new Date()) {
  const windowExpired = !current || now.getTime() - current.windowStartedAt.getTime() >= LOGIN_WINDOW_MS;
  const failedCount = windowExpired ? 1 : current.failedCount + 1;
  return {
    failedCount,
    windowStartedAt: windowExpired ? now : current.windowStartedAt,
    blockedUntil: failedCount >= LOGIN_MAX_FAILURES ? new Date(now.getTime() + LOGIN_BLOCK_MS) : null,
  };
}
