import { expect, test, type Page } from "@playwright/test";
const password = "Mwein-E2E-Password-2026!";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("button", { name: "Sign in securely" })).toHaveCount(0);
}
test("governance administrator can onboard a DPO through staff access", async ({ page }) => {
  await login(page, "facility.admin@example.test");
  await page.getByRole("button", { name: "Administration", exact: true }).click();
  await page.getByRole("button", { name: "Users & access", exact: true }).click();
  await page.getByText("Add staff member", { exact: true }).first().click();
  await page.getByLabel("Full name *", { exact: true }).fill("Browser DPO");
  await page.getByLabel("Work email *", { exact: true }).fill("browser.dpo@example.test");
  await page.getByRole("combobox", { name: "Role *", exact: true }).selectOption("DATA_PROTECTION_OFFICER");
  await page.getByLabel("Temporary password *", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create staff account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Staff account created. Share the temporary password securely." })).toBeVisible();
  await expect(page.getByLabel("Full name *", { exact: true })).toHaveValue("");
  await page.getByLabel("Search staff", { exact: true }).fill("browser.dpo");
  await expect(page.locator(".staffDisclosure")).toContainText("Data protection officer");
});
test("HR sees protected DPO accounts and cannot select protected reporting roles", async ({ page }) => {
  await login(page, "hr@example.test");
  await page.getByRole("button", { name: "Administration", exact: true }).click();
  await page.getByRole("button", { name: "Users & access", exact: true }).click();
  await page.getByLabel("Search staff", { exact: true }).fill("privacy@example.test");
  await expect(page.locator(".staffDisclosure")).toContainText("Protected");
  await page.locator(".staffDisclosure summary").click();
  await expect(page.locator(".staffDisclosure").getByRole("button", { name: "Save access" })).toHaveCount(0);
  await page.getByText("Add staff member", { exact: true }).first().click();
  await expect(page.getByRole("combobox", { name: "Role *", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Role *", exact: true }).locator('option[value="DATA_PROTECTION_OFFICER"], option[value="REPORTING_OFFICER"]')).toHaveCount(0);
});
test("reporting officer opens both reports without patient or cashier access", async ({ page }) => {
  await login(page, "reports@example.test");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Facility reports", exact: true })).toBeVisible();
  await expect(page.getByText("Gross billed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generate monthly summary", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Diagnosis totals", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Billing", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Patient records", exact: true })).toHaveCount(0);
});
for (const email of ["billing@example.test", "clinician.cover@example.test"]) test(`${email} retains billing navigation without reports`, async ({ page }) => {
  await login(page, email);
  await expect(page.getByRole("button", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reports", exact: true })).toHaveCount(0);
});
