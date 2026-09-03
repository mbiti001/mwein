import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string) {
  if (password.length < 16) throw new Error("Password must contain at least 16 characters");
  const salt = randomBytes(24);
  const digest = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [algorithm, saltValue, digestValue] = stored.split("$");
  if (algorithm !== "scrypt" || !saltValue || !digestValue) return false;
  const expected = Buffer.from(digestValue, "base64url");
  const actual = scryptSync(password, Buffer.from(saltValue, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

export const newSessionToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const normalizeName = (name: string) => name.trim().toLocaleLowerCase("en-KE").replace(/\s+/g, " ");
