export const MFA_CHALLENGE_MS = 10 * 60 * 1000;
export const MFA_BLOCK_MS = 15 * 60 * 1000;
export const MFA_MAX_FAILURES = 5;
export function workforceMfaRequired(env: Record<string, string | undefined> = process.env) {
  return env.MFA_REQUIRED === "true" || (env.NODE_ENV === "production" && env.MFA_REQUIRED !== "false");
}
export function sessionNeedsMfa(enrolled: boolean, verifiedAt: Date | null | undefined, required = workforceMfaRequired()) {
  return (required || enrolled) && !verifiedAt;
}
