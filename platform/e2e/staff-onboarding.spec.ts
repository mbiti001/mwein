import { expect, test, type Page } from "@playwright/test";
const password = "Mwein-E2E-Password-2026!";
async function login(page: Page, email: string, secret = password) {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(secret);
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
  await page.getByRole("group", { name: "Assigned roles *" }).first().getByRole("checkbox", { name: "Data protection officer", exact: true }).check();
  await page.getByLabel("Temporary password *", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create staff account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Staff account created. Share the temporary password securely." })).toBeVisible();
  await expect(page.getByLabel("Full name *", { exact: true })).toHaveValue("");
  // Success must not hide the action or make the next onboarding impossible.
  await expect(page.getByRole("button", { name: "Create staff account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create staff account", exact: true })).toBeEnabled();
  await page.getByLabel("Search staff", { exact: true }).fill("browser.dpo");
  await expect(page.locator(".staffDisclosure")).toContainText("Data protection officer");
});

test("one staff account can use Consultation and Pharmacy until Pharmacy is removed", async ({ page, browser }) => {
  const email = "browser.multirole@example.test";
  await login(page, "facility.admin@example.test");
  await page.getByRole("button", { name: "Administration", exact: true }).click();
  await page.getByRole("button", { name: "Users & access", exact: true }).click();
  const add = page.locator("details").filter({ has: page.getByRole("heading", { name: "Add staff member", includeHidden: true }) });
  await add.locator("summary").click();
  await add.getByLabel("Full name *").fill("Multi-role fixture");
  await add.getByLabel("Work email *").fill(email);
  await add.getByLabel("Temporary password *").fill(password);
  await add.getByRole("checkbox", { name: "Clinician", exact: true }).check();
  await add.getByRole("checkbox", { name: "Pharmacy & inventory officer", exact: true }).check();
  await add.getByRole("button", { name: "Create staff account" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Staff account created" })).toBeVisible();
  // Either assigned role is searchable and both are displayed on the same individual account.
  const account = page.locator(".staffDisclosure").filter({ hasText: email });
  const search = page.getByLabel("Search staff");
  for (const name of ["Clinician", "Pharmacy & inventory officer"]) {
    await search.fill(name);
    await expect(account.locator("summary")).toContainText("Clinician, Pharmacy & inventory officer");
  }
  await search.fill(email);
  const staff = await browser.newContext();
  try {
    const workspace = await staff.newPage();
    const status = (path: string) => workspace.evaluate(async url => (await fetch(url)).status, path);
    await login(workspace, email);
    await workspace.getByLabel("Temporary password").fill(password);
    await workspace.getByLabel("New password").fill(password + "-changed");
    await workspace.getByRole("button", { name: "Change password", exact: true }).click();
    const consult = workspace.getByRole("button", { name: "Consultation", exact: true });
    const pharmacy = workspace.getByRole("button", { name: "Pharmacy & stock", exact: true });
    await expect(consult).toBeVisible();
    await expect(pharmacy).toBeVisible();
    expect(await status("/api/inventory")).toBe(200);
    expect(await status("/api/admin/users")).toBe(403);

    await account.locator("summary").click();
    await expect(account.getByRole("checkbox", { name: "Clinician", exact: true })).toBeChecked();
    await account.getByRole("checkbox", { name: "Pharmacy & inventory officer", exact: true }).uncheck();
    await account.getByRole("button", { name: "Save access" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Staff access updated" })).toBeVisible();
    await expect(account.locator("summary")).not.toContainText("Pharmacy");
    expect(await status("/api/inventory")).toBe(401);
    await login(workspace, email, password + "-changed");
    await expect(consult).toBeVisible();
    await expect(pharmacy).toHaveCount(0);
    expect(await status("/api/inventory")).toBe(403);
  } finally { await staff.close(); }
});
