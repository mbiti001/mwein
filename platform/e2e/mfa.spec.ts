import { expect, test, type Page } from "@playwright/test";
import { TOTP } from "otpauth";
const password = "Mwein-E2E-Password-2026!";
async function login(page: Page, email: string, loginPassword = password) {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(loginPassword);
  const signedIn = page.waitForResponse(response => response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  const response = await signedIn; expect(response.status()).toBe(200); await response.finished();
  await expect(page.getByRole("heading", { name: /^(My work now|Choose your permanent password|Verify your sign-in|Set up multi-factor authentication)$/ })).toBeVisible();
}
async function request(page: Page, path: string, data?: unknown) {
  return page.evaluate(async ({ path, data }) => {
    const response = await fetch(path, data === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }, { path, data });
}
function code(secret: string, drift = 0) { return new TOTP({ secret }).generate({ timestamp: Date.now() + drift }); }
async function finishSetup(page: Page) {
  await page.getByText("Enter a setup key manually").click();
  const secret = await page.getByLabel("Authenticator setup key").inputValue();
  const usedCode = code(secret);
  await page.getByLabel("Six-digit authenticator code").fill(usedCode);
  await page.getByRole("button", { name: "Confirm authenticator" }).click();
  const codes = (await page.getByLabel("Recovery codes", { exact: true }).innerText()).trim().split("\n");
  expect(codes).toHaveLength(10);
  await page.getByLabel("I have saved my recovery codes securely").check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
  return { secret, codes, usedCode };
}
async function confirmViaApi(page: Page, secret: string) {
  const usedCode = code(secret);
  const confirmed = await request(page, "/api/auth/mfa", { action: "CONFIRM", code: usedCode });
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.recoveryCodes).toHaveLength(10);
  await page.reload();
  await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
  return { secret, codes: confirmed.body.recoveryCodes as string[], usedCode };
}
async function enroll(page: Page, email: string) {
  await login(page, email);
  // Optional account-security navigation was intentionally removed. Exercise its
  // authenticated API controls; required sign-in/recovery screens remain UI-tested.
  await expect(page.getByRole("button", { name: "Account security", exact: true })).toHaveCount(0);
  const setup = await request(page, "/api/auth/mfa", { action: "START", password });
  expect(setup.status).toBe(200);
  return confirmViaApi(page, setup.body.secret);
}
async function relogin(page: Page, email: string) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, email);
  await expect(page.getByRole("heading", { name: "Verify your sign-in" })).toBeVisible();
}
async function verify(page: Page, value: string) {
  await page.getByLabel("Authenticator or recovery code").fill(value);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
}

test("MFA enrollment, replay protection, recovery and protected replacement", async ({ page }) => {
  test.setTimeout(60000);
  const email = "mfa.staff@example.test";
  const first = await enroll(page, email);
  await relogin(page, email);
  const pending = await request(page, "/api/auth/me");
  expect(pending.body.user.permissions).toEqual([]);
  expect(pending.body.user.mfaRequired).toBe(true);
  expect((await request(page, "/api/visits")).status).toBe(403);
  expect((await request(page, "/api/auth/password", { currentPassword: password, newPassword: "Synthetic-Changed-Password-2026!" })).status).toBe(403);
  // The enrollment step was already consumed: the same step must not authenticate again.
  await verify(page, first.usedCode);
  await expect(page.getByRole("alert").filter({ hasText: "Verification failed" })).toContainText("Verification failed");
  await verify(page, code(first.secret, 30000));
  await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
  await relogin(page, email);
  await verify(page, first.codes[0]);
  await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
  await relogin(page, email);
  await verify(page, first.codes[0]);
  await expect(page.getByRole("alert").filter({ hasText: "Verification failed" })).toContainText("Verification failed");
  await verify(page, first.codes[1]);
  const regeneratedResponse = await request(page, "/api/auth/mfa", { action: "RECOVERY_CODES", password, code: first.codes[2] });
  expect(regeneratedResponse.status).toBe(200);
  const regenerated = regeneratedResponse.body.recoveryCodes as string[];
  expect(regenerated).toHaveLength(10);
  expect(regenerated).not.toEqual(first.codes);
  await relogin(page, email);
  await verify(page, first.codes[3]);
  await expect(page.getByRole("alert").filter({ hasText: "Verification failed" })).toContainText("Verification failed");
  await verify(page, regenerated[0]);
  const replacementResponse = await request(page, "/api/auth/mfa", { action: "REPLACE", password, code: regenerated[1] });
  expect(replacementResponse.status).toBe(200);
  const replacement = await confirmViaApi(page, replacementResponse.body.secret);
  expect(replacement.secret).not.toBe(first.secret);
  await relogin(page, email);
  await verify(page, code(first.secret, 30000));
  await expect(page.getByRole("alert").filter({ hasText: "Verification failed" })).toContainText("Verification failed");
  // Two simultaneous requests may consume a recovery code only once.
  const concurrent = await page.evaluate(async code => Promise.all([0, 1].map(async () => {
    const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "VERIFY", code }) });
    return response.status;
  })), replacement.codes[0]);
  expect(concurrent.filter(status => status === 200)).toHaveLength(1);
  expect(concurrent.every(status => [200, 401, 409].includes(status))).toBe(true);
  const authenticated = await request(page, "/api/auth/me");
  expect(authenticated.body.user.mfaRequired).toBe(false);
  expect(authenticated.body.user.permissions).toContain("visit.read");
  expect((await request(page, "/api/admin/users")).status).toBe(403);
});

test("five wrong MFA attempts lock the account across new password sessions", async ({ page }) => {
  const email = "mfa.lock@example.test";
  const enrolled = await enroll(page, email);
  await relogin(page, email);
  for (let attempt = 0; attempt < 5; attempt++) {
    const failed = await request(page, "/api/auth/mfa", { action: "VERIFY", code: "invalid-synthetic-code" });
    expect(failed.status).toBe(attempt === 4 ? 429 : 401);
  }
  expect((await request(page, "/api/auth/mfa", { action: "VERIFY", code: enrolled.codes[0] })).status).toBe(429);
  await relogin(page, email);
  expect((await request(page, "/api/auth/mfa", { action: "VERIFY", code: enrolled.codes[0] })).status).toBe(429);
  expect((await request(page, "/api/visits")).status).toBe(403);
});

test("lost-factor recovery preserves MFA, revokes sessions and requires identity attestation by a separate verified admin", async ({ page, browser }) => {
  const targetEmail = "mfa.recover@example.test";
  const original = await enroll(page, targetEmail);
  const target = (await request(page, "/api/auth/me")).body.user;
  const adminContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await enroll(admin, "mfa.admin@example.test");
    const actor = (await request(admin, "/api/auth/me")).body.user;
    const recoveryPassword = "Synthetic-Recovery-Password-2026!";
    const payload = { identityCheckReference: "SYNTHETIC-IDENTITY-CHECK-001", identityChecked: true, temporaryPassword: recoveryPassword };
    expect((await request(page, `/api/admin/users/${actor.id}/mfa-recovery`, payload)).status).toBe(403);
    expect((await request(admin, `/api/admin/users/${actor.id}/mfa-recovery`, payload)).status).toBe(403);
    expect((await request(admin, "/api/admin/users/11111111-1111-4111-8111-111111111111/mfa-recovery", payload)).status).toBe(404);
    expect((await request(admin, `/api/admin/users/${target.id}/mfa-recovery`, { ...payload, identityChecked: false })).status).toBe(422);
    // A password reset alone must not remove the existing authenticator.
    const reset = await admin.evaluate(async ({ id, temporaryPassword }) => {
      const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, temporaryPassword }) });
      return response.status;
    }, { id: target.id, temporaryPassword: recoveryPassword });
    expect(reset).toBe(200);
    expect((await request(page, "/api/visits")).status).toBe(401);
    await login(page, targetEmail, recoveryPassword);
    await expect(page.getByRole("heading", { name: "Verify your sign-in" })).toBeVisible();
    expect((await request(page, "/api/auth/password", { currentPassword: recoveryPassword, newPassword: "Replacement-Password-2026!" })).status).toBe(403);
    const recovered = await request(admin, `/api/admin/users/${target.id}/mfa-recovery`, payload);
    expect(recovered.status).toBe(200);
    expect((await request(page, "/api/auth/me")).status).toBe(401);
    await login(page, targetEmail, recoveryPassword);
    const pending = (await request(page, "/api/auth/me")).body.user;
    expect(pending.mfaRequired).toBe(true); expect(pending.mfaEnrolled).toBe(false); expect(pending.permissions).toEqual([]);
    expect((await request(page, "/api/visits")).status).toBe(403);
    expect((await request(page, "/api/auth/mfa", { action: "VERIFY", code: original.codes[0] })).status).toBe(409);
    const newPassword = "Replacement-Password-2026!";
    expect((await request(page, "/api/auth/password", { currentPassword: recoveryPassword, newPassword })).status).toBe(200);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Set up multi-factor authentication" })).toBeVisible();
    expect((await request(page, "/api/visits")).status).toBe(403);
    await page.getByLabel("Current password").fill(newPassword);
    await page.getByRole("button", { name: "Start MFA setup" }).click();
    const replacement = await finishSetup(page);
    expect(replacement.secret).not.toBe(original.secret);
    expect((await request(page, "/api/visits")).status).toBe(200);
  } finally { await adminContext.close(); }
});
