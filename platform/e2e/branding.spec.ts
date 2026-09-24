import { test, expect } from "@playwright/test";

test("website wordmark is prominent and blank clinic forms print with isolated letterheads", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Brand reviewer", email: "test@example.test", facility: { name: "Mwein Medical Services", timezone: "Africa/Nairobi" }, permissions: ["visit.read"], roles: ["TEST"], mustChangePassword: false, mfaRequired: false, mfaEnrolled: false } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [] } }));
  await page.goto("/");
  const logo = page.locator(".sidebar .brandWordmark");
  await expect(logo).toHaveAttribute("src", "/brand/mwein-wordmark.png");
  expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: "Clinic forms", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clinic forms", exact: true })).toBeVisible();
  for (const title of ["Sick sheet", "Maternity delivery record", "Delivery note", "Gate pass"]) {
    await page.getByLabel("Document type").selectOption({ label: title });
    await expect(page.locator(".clinicFormPaper h1")).toHaveText(title);
    await expect(page.locator(".clinicFormPaper .facilityLetterheadWordmark")).toBeVisible();
    await page.evaluate(() => { window.print = () => { (window as any).printed = document.getElementById("clinic-form-print")?.outerHTML; }; });
    await page.getByRole("button", { name: "Print blank form / Save PDF" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).printed || "")).toContain(title);
    const printed = await page.evaluate(() => (window as any).printed as string);
    expect(printed).toContain("/brand/mwein-wordmark.png");
    expect(printed).toContain("Blank form");
    expect(printed).not.toContain("Brand reviewer");
  }
  await page.screenshot({ path: "/tmp/mwein-branded-hmis.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".mobileWordmark")).toBeVisible();
  await expect.poll(() => page.locator("#main-navigation").evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.evaluate(() => { document.body.insertAdjacentHTML("beforeend", (window as any).printed); document.body.classList.add("printingClinicForm"); });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".shell")).toBeHidden();
  await expect(page.locator("#clinic-form-print .facilityLetterheadWordmark")).toBeVisible();
  await page.screenshot({ path: "/tmp/mwein-gate-pass-print.png", fullPage: true, animations: "disabled" });
});

test("sign-in uses the website wordmark", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ status: 401, json: { error: "Sign in" } }));
  await page.goto("/");
  await expect(page.locator(".publicNav .brandWordmark")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
