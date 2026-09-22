import { TOTP } from "otpauth";

// Runs only against the isolated production-mode fixture, with mandatory MFA enabled.
export async function verifyMandatoryMfa({ origin, pg, password, assert, steps }) {
  let cookie = "";
  async function request(path, data, withCookie = cookie) {
    const response = await fetch(`${origin}${path}`, { method: data ? "POST" : "GET", headers: { cookie: withCookie, origin, "content-type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
    return { response, body: await response.json() };
  }
  const credentials = { facilityCode: "MMS", email: "mfa.enforcement@example.test", password };
  const login = await request("/api/auth/login", credentials);
  assert(login.response.ok && login.body.user.mfaRequired && !login.body.user.mfaEnrolled && login.body.user.permissions.length === 0, "Mandatory MFA login did not withhold operational permissions");
  cookie = login.response.headers.get("set-cookie").split(";")[0];
  const passwordCookie = cookie;
  assert((await request("/api/visits")).response.status === 403, "Mandatory MFA allowed an unenrolled user to read visits");
  const setup = await request("/api/auth/mfa", { action: "START", password });
  assert(setup.response.ok && setup.body.secret && setup.body.qrCode?.startsWith("data:image/png"), "Mandatory enrollment did not provide a local QR code");
  const otherSession = await request("/api/auth/login", credentials);
  const otherCookie = otherSession.response.headers.get("set-cookie").split(";")[0];
  const otp = new TOTP({ secret: setup.body.secret }).generate();
  assert((await request("/api/auth/mfa", { action: "CONFIRM", code: otp }, otherCookie)).response.status === 409, "Enrollment challenge was not bound to its session");
  const confirmed = await request("/api/auth/mfa", { action: "CONFIRM", code: otp });
  assert(confirmed.response.ok && confirmed.body.recoveryCodes?.length === 10, "Mandatory MFA enrollment did not complete");
  cookie = confirmed.response.headers.get("set-cookie").split(";")[0];
  assert(cookie !== passwordCookie, "MFA did not rotate the password-stage cookie");
  assert((await request("/api/visits", undefined, passwordCookie)).response.status === 401, "Password-stage session remained usable after MFA");
  assert((await request("/api/visits", undefined, otherCookie)).response.status === 401, "Enrollment did not revoke other sessions");
  assert((await request("/api/visits")).response.ok, "Verified clinician could not use assigned access");
  assert((await request("/api/admin/users")).response.status === 403, "MFA elevated the clinician's role");
  const stored = (await pg.query(`SELECT m."secretCiphertext", m."recoveryHashes" FROM "UserMfa" m JOIN "User" u ON u."id"=m."userId" WHERE u."email"=$1`, [credentials.email])).rows[0];
  assert(stored.secretCiphertext.startsWith("v1.") && !stored.secretCiphertext.includes(setup.body.secret), "Authenticator seed was not encrypted");
  assert(stored.recoveryHashes.length === 10 && !stored.recoveryHashes.includes(confirmed.body.recoveryCodes[0]), "Recovery codes were not stored as hashes");
  const me = await request("/api/auth/me");
  assert(!JSON.stringify(me.body).includes(setup.body.secret) && !JSON.stringify(me.body).includes(stored.secretCiphertext), "Account response exposed the authenticator secret");
  steps.push("enforce mandatory MFA, session-bound enrollment, token rotation, revocation, encrypted storage and least privilege");
}
