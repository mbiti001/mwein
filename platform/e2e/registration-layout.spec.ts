import { test, expect } from "@playwright/test";

test("registration groups related fields horizontally and retains route-specific consent controls", async ({ page }, testInfo) => {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Registration reviewer", email: "reviewer@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["patient.create", "visit.create"], mustChangePassword: false, mfaRequired: false, mfaEnrolled: false } } }));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "Registration", exact: true }).click();
  const form = page.getByRole("form", { name: "Patient registration" });
  for (const [selector, count] of [[".registrationNames", 3], [".registrationDemographics", 4], [".registrationLocation", 4], [".registrationConsents", 3]] as const) {
    const positions = await form.locator(`${selector}>label`).evaluateAll(elements => elements.map(el => el.getBoundingClientRect().y));
    expect(positions).toHaveLength(count);
    expect(new Set(positions).size).toBe(1);
  }
  await page.getByLabel("First name *").fill("Synthetic");
  await page.getByLabel("Middle name").fill("Layout");
  await page.getByLabel("Surname *").fill("Reviewer");
  await form.screenshot({ path: testInfo.outputPath("registration-desktop.png") });
  await page.getByLabel("Registration route").selectOption("GUARDIAN_ASSISTED");
  await expect(page.getByLabel("Representative name *")).toBeVisible();
  await expect(page.getByLabel("Representative phone *")).toHaveAttribute("required", "");
  await page.getByLabel("Registration route").selectOption("EMERGENCY_UNKNOWN");
  await expect(page.getByLabel("Emergency registration reason *")).toBeVisible();
  await expect(page.getByLabel("Consent to treatment")).not.toHaveAttribute("required", "");
  await page.getByLabel("Registration route").selectOption("STANDARD");
  await expect(page.getByLabel("Consent to treatment *")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Consent to electronic record *")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Consent to appointment messages")).not.toHaveAttribute("required", "");
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await form.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel("First name *")).toHaveValue("Synthetic");
    await form.screenshot({ path: testInfo.outputPath(`registration-${width}.png`) });
  }
});
