import { expect, test, type Page } from "@playwright/test";
const password = "Mwein-E2E-Password-2026!";
async function login(page: Page, email: string) {
  await page.goto("/"); await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
}
async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const r = await fetch(path, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    return { status: r.status, cache: r.headers.get("cache-control"), data: await r.json() };
  }, { path, method, body });
}
for (const email of ["billing@example.test", "clinician.cover@example.test"]) {
  test(`${email} keeps billing without reports`, async ({ page }) => {
    await login(page, email);
    await expect(page.getByRole("button", { name: "Reports", exact: true })).toHaveCount(0);
    for (const path of ["/api/reports/moh-monthly?month=2026-09", "/api/reports/operations?from=2026-09-01&to=2026-09-22"]) {
      const result = await api(page, path); expect(result.status).toBe(403); expect(result.cache).toContain("no-store");
    }
    expect((await api(page, "/api/billing/shifts")).status).toBe(200);
  });
}
test("finance reports do not grant clinical summaries", async ({ page }) => {
  await login(page, "finance.manager@example.test");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Facility reports" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly MOH/KHIS source summary" })).toHaveCount(0);
  expect((await api(page, "/api/reports/moh-monthly?month=2026-09")).status).toBe(403);
  expect((await api(page, "/api/reports/operations?from=2026-09-01&to=2026-09-22")).status).toBe(200);
});
test("DPO is assignable by governance admin but protected from HR management", async ({ page, browser }) => {
  await login(page, "facility.admin@example.test");
  await page.getByRole("button", { name: "Administration", exact: true }).click();
  await page.getByRole("button", { name: "Users & access", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Add staff member" }).click();
  await page.getByRole("combobox", { name: "Role *", exact: true }).selectOption("DATA_PROTECTION_OFFICER");
  const staff = await api(page, "/api/admin/users");
  expect(staff.status).toBe(200);
  expect(staff.data.roles.find((r: any) => r.code === "DATA_PROTECTION_OFFICER").assignable).toBe(true);
  await page.getByLabel("Full name *", { exact: true }).fill("Synthetic DPO");
  await page.getByLabel("Work email *", { exact: true }).fill(`dpo-${Date.now()}@example.test`);
  await page.getByLabel("Temporary password *", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create staff account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Staff account created." })).toBeVisible();
  await expect(page.getByLabel("Full name *", { exact: true })).toHaveValue("");
  const dpo = staff.data.users.find((u: any) => u.email === "privacy@example.test");
  const dpoContext = await browser.newContext(); const dpoPage = await dpoContext.newPage();
  await login(dpoPage, "privacy@example.test");
  expect((await api(dpoPage, "/api/patients?q=Browser")).status).toBe(200);
  const hrContext = await browser.newContext(); const hr = await hrContext.newPage();
  await login(hr, "hr.admin@example.test");
  for (const patch of [{ status: "DISABLED" }, { temporaryPassword: password }, { roleCode: "RECEPTION" }])
    expect((await api(hr, "/api/admin/users", "PATCH", { id: dpo.id, ...patch })).status).toBe(403);
  expect((await api(hr, "/api/admin/users", "POST", { displayName: "Forbidden DPO", email: "forbidden-dpo@example.test", temporaryPassword: password, roleCode: "DATA_PROTECTION_OFFICER" })).status).toBe(403);
  // Reassigning a governed role must invalidate its previously established session.
  expect((await api(page, "/api/admin/users", "PATCH", { id: dpo.id, roleCode: "DATA_PROTECTION_OFFICER" })).status).toBe(200);
  expect((await api(dpoPage, "/api/patients?q=Browser")).status).toBe(401);
  expect((await api(page, "/api/admin/users", "PATCH", { id: "00000000-0000-4000-8000-000000000001", status: "DISABLED" })).status).toBe(404);
  await hrContext.close(); await dpoContext.close();
});
