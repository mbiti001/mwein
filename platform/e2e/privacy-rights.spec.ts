import { expect, test } from "@playwright/test";

test("DPO records consent and fulfills an audited export without mixing patient forms", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email").fill("privacy@example.test");
  await page.getByLabel("Password").fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Administration", exact: true }).click();
  await page.getByRole("button", { name: "Privacy & rights", exact: true }).click();
  await page.getByLabel("Find patient", { exact: true }).fill("Amina");
  await page.getByRole("button", { name: /Amina E2E Patient/ }).click();
  await page.getByLabel("Notice version").fill("BROWSER-NOTICE-1");
  await page.getByRole("button", { name: "Record decision", exact: true }).click();
  await expect(page.locator(".row").filter({ hasText: "BROWSER-NOTICE-1" })).toBeVisible();
  await expect(page.getByLabel("Notice version")).toHaveValue("MWEIN-PRIVACY-1");
  await page.getByLabel("Request type").selectOption("PORTABLE_EXPORT");
  await page.getByLabel("Due date").fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await page.getByLabel("Request details").fill("Browser verified portable record request");
  await page.getByRole("button", { name: "Record request", exact: true }).click();

  const row = page.locator(".row").filter({ hasText: "Browser verified portable record request" });
  await row.getByRole("button", { name: "Verify identity" }).click();
  await row.getByRole("button", { name: "Start review" }).click();
  const downloadPromise = page.waitForEvent("download");
  await row.getByRole("button", { name: "Generate export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^mwein-patient-export-.*\.json$/);
  await expect(row).toContainText("COMPLETED");
  await expect(row).toContainText("audit:");
  await page.getByLabel("Request details").fill("Draft for Amina must not follow another patient");
  await page.getByLabel("Find patient", { exact: true }).fill("Child");
  await page.getByRole("button", { name: /Child E2E Patient/ }).click();
  await expect(page.getByText(/Managing privacy record for/)).toContainText("Child E2E Patient");
  await expect(page.getByLabel("Request details")).toHaveValue("");
  await expect(page.getByText("Browser verified portable record request", { exact: true })).toHaveCount(0);
});
