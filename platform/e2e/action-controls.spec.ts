import { expect, test } from "@playwright/test";

test("sign-in shows pending feedback, preserves inputs on failure and supports keyboard retry", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@mwein.local");
  await page.getByLabel("Password", { exact: true }).fill("Mwein-E2E-Password-2026!");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route("**/api/auth/login", async route => {
    calls++;
    await gate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic connection interruption; retry sign-in." }) });
  });
  await page.getByRole("button", { name: "Sign in securely" }).click();
  const pending = page.getByRole("button", { name: "Signing in…" });
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page.locator(".landingLogin").getByRole("alert")).toContainText("Synthetic connection interruption");
  await expect(page.getByRole("button", { name: "Sign in securely" })).toBeEnabled();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("admin@mwein.local");
  expect(calls).toBe(1);
  await page.unroute("**/api/auth/login");
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
});

test("action controls remain reachable with clear focus at phone width", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@mwein.local");
  await page.getByLabel("Password", { exact: true }).fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Clinic forms", exact: true }).click();
  await page.getByLabel("Document type").selectOption("DELIVERY");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  const save = page.getByRole("button", { name: "Save draft", exact: true });
  await save.focus();
  await expect(save).toBeFocused();
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await save.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/mwein-main-actions-mobile.png", animations: "disabled" });
});
