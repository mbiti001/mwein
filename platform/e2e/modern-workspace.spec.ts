import { test, expect } from "@playwright/test";

test("workspace presents evidence honestly and filters queues", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email", { exact: true }).fill("admin@mwein.local");
  await page.getByLabel("Password", { exact: true }).fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("heading", { name: "Readiness, backed by evidence" })).toBeVisible();
  await expect(page.getByText("Internal evidence indicators supporting DHA preparation. Not a DHA score or certification.")).toBeVisible();
  await page.getByRole("searchbox", { name: "Find a task", exact: true }).fill("no-matching-patient-xyz");
  await expect(page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Next actions", exact: true }) }).locator(".taskRow")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Overdue only" }).check();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
