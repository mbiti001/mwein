import { test, expect } from "@playwright/test";

test("staff can identify the running build on a phone without adding it to printed documents", async ({ page, request }, testInfo) => {
  const health = await (await request.get("/api/health")).json();
  await page.goto("/");
  const stamp = page.getByRole("contentinfo", { name: "Application build" });
  const summary = stamp.locator("summary");
  await expect(summary).toContainText(`Mwein ${health.release.version}`);
  await expect(summary).toContainText(health.release.commit === "local" ? "local development" : health.release.shortCommit);
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(stamp.locator("dd").first()).toHaveText(health.release.commit);
  await page.setViewportSize({ width: 320, height: 844 });
  await stamp.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("build-stamp-mobile.png"), animations: "disabled" });
  await page.emulateMedia({ media: "print" });
  await expect(stamp).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Build reviewer", email: "reviewer@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: [], mustChangePassword: false, mfaRequired: false, mfaEnrolled: false } } }));
  await page.reload();
  await expect(page.getByRole("button", { name: "☰ Menu" })).toBeVisible();
  await expect(summary).toContainText(health.release.commit === "local" ? "local development" : health.release.shortCommit);
});
