import { expect, test, type Page } from "@playwright/test";

const password = "Mwein-E2E-Password-2026!";

async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
}

test("renders the tenant-aware staff sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Facility code")).toHaveValue("MMS");
  await expect(page.getByText("Authorised facility staff only. All access is recorded.")).toBeVisible();
});

test("requires a temporary password replacement before opening records", async ({ page }) => {
  await login(page, "temporary@example.test");
  await expect(page.getByRole("heading", { name: "Choose your permanent password" })).toBeVisible();
  await expect(page.getByText("Replace it before opening patient records.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();
});

test("loads administration and production release gates after authentication", async ({ page }) => {
  await login(page, "admin@mwein.local");
  await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
  await page.getByRole("button", { name: "Administration" }).click();
  await expect(page.getByRole("heading", { name: "Facility control centre" })).toBeVisible();
  await page.getByRole("button", { name: "Release gates" }).click();
  await expect(page.getByRole("heading", { name: "Production release gates" })).toBeVisible();
  await expect(page.getByText("0/9")).toBeVisible();
  await expect(page.getByText("Workforce MFA", { exact: true })).toBeVisible();
});

test("keeps a system-administrator-only account in administration", async ({ page }) => {
  await login(page, "system.only@example.test");
  await expect(page.getByRole("button", { name: "Administration" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registration" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Consultation" })).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Find a patient anywhere" })).toHaveCount(0);
});

test("starts triage with blank measured observations and an explicit concern", async ({ page }) => {
  await login(page, "admin@mwein.local");
  await page.getByRole("button", { name: "Registration" }).click();
  await page.getByLabel("First name *").fill("Browser");
  await page.getByLabel("Surname *").fill("Triage Check");
  await page.getByLabel("Estimated age").fill("30");
  await page.getByLabel("Sex at birth *").selectOption("FEMALE");
  await page.getByLabel("Phone *").fill("+254700654321");
  await page.getByLabel("Subcounty *").fill("Teso North");
  await page.getByLabel("Consent to treatment *").check();
  await page.getByLabel("Consent to electronic record *").check();
  await page.getByRole("button", { name: "Register patient and continue" }).click();
  await page.getByRole("button", { name: "Check in patient" }).click();

  await expect(page.getByLabel("Temperature °C")).toHaveValue("");
  await expect(page.getByLabel("Consciousness")).toHaveValue("");
  await expect(page.getByLabel("Triage category *")).toHaveValue("");
  await expect(page.getByLabel("Presenting concern / immediate red flag *")).toBeVisible();
  await expect(page.getByText("No “normal” observations are prefilled.")).toBeVisible();
});

test("keeps authenticated navigation usable at a mobile breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "admin@mwein.local");
  const menu = page.getByRole("button", { name: "☰ Menu" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Administration" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
