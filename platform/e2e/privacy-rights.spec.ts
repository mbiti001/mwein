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
  await expect(page.getByText("Portability response · 30 days.", { exact: false })).toBeVisible();
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

test("rights intake retains original receipt, reports overdue work and recovers a saved response after refresh failure", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email").fill("privacy@example.test");
  await page.getByLabel("Password").fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Administration", exact: true }).click();
  await page.getByRole("button", { name: "Privacy & rights", exact: true }).click();
  await page.getByLabel("Find patient", { exact: true }).fill("Amina");
  await page.getByRole("button", { name: /Amina E2E Patient/ }).click();
  await expect(page.getByLabel("Due date", { exact: true })).toHaveCount(0);
  await page.getByLabel("Received at (Nairobi)").fill("2020-01-29T12:30");
  const details = "Original receipt retained in overdue browser request";
  await page.getByLabel("Request details").fill(details);
  let posts = 0;
  let failRefresh = true;
  let saved: any;
  await page.route(/\/api\/patients\/[^/]+\/privacy$/, async route => {
    if (route.request().method() === "POST") {
      posts++;
      const response = await route.fetch(); saved = await response.json();
      return route.fulfill({ response });
    }
    if (failRefresh) { failRefresh = false; return route.fulfill({ status: 503, json: { error: "Synthetic refresh failure" } }); }
    return route.continue();
  });
  await page.getByRole("button", { name: "Record request", exact: true }).click();
  await expect(page.getByText(/Saved successfully, but the updated history/)).toBeVisible();
  expect(saved.record).toMatchObject({ requestedAt: "2020-01-29T09:30:00.000Z", dueAt: "2020-02-05T09:30:00.000Z" });
  await expect(page.getByRole("button", { name: "Record request", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reload privacy record" }).click();
  const row = page.locator(".row").filter({ hasText: details });
  await expect(row).toContainText("Overdue");
  await expect(row).toContainText("29 Jan 2020");
  await expect(row).toContainText("5 Feb 2020");
  await row.getByRole("button", { name: "Verify identity" }).click();
  await expect(row).toContainText("IDENTITY VERIFIED");
  await expect(row).toContainText("5 Feb 2020");
  expect(posts).toBe(2); // One intake, one identity transition; reload never repeats the intake.
  await page.getByLabel("Received at (Nairobi)").fill("2099-01-01T12:30");
  await page.getByLabel("Request details").fill("Keep this draft when future receipt is rejected");
  await page.getByRole("button", { name: "Record request", exact: true }).click();
  await expect(page.getByText(/Receipt time cannot be in the future/)).toBeVisible();
  await expect(page.getByLabel("Request details")).toHaveValue("Keep this draft when future receipt is rejected");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll(".privacyRightsWorkspace *")].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8).map(el => `${el.tagName}.${el.className}`),
    }))).toMatchObject({ width, scroll: width });
  }
  await page.getByRole("heading", { name: "Open a rights request" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../outputs/mwein-rights-intake-mobile.png", fullPage: true });
});
