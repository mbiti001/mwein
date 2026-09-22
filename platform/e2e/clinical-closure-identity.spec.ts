import { expect, test } from "@playwright/test";

test("clinician discharges a signed visit and reverses a reviewed identity correction", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email", { exact: true }).fill("admin@mwein.local");
  await page.getByLabel("Password", { exact: true }).fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  const closure = page.locator("section").filter({ has: page.getByRole("heading", { name: "Clinical discharge", exact: true }) });
  await closure.getByLabel("Patient and visit").selectOption({ label: "Amina E2E Patient · E2E-BROWSER-CLOSE · ADMITTED" });
  await closure.getByLabel("Clinical outcome").selectOption("OUTPATIENT");
  await closure.getByLabel("Closure summary, follow-up and handover").fill("Stable for outpatient follow-up; return precautions reviewed.");
  await closure.getByRole("button", { name: "Confirm clinical discharge" }).click();
  await expect(closure.getByRole("status")).toContainText("Clinical closure recorded");
  await expect(closure.locator("option").filter({ hasText: "E2E-BROWSER-CLOSE" })).toHaveCount(0);

  await page.getByText("Patient identity review and corrections", { exact: true }).click();
  const identity = page.locator("section").filter({ has: page.getByText("Patient identity review and corrections", { exact: true }) });
  await identity.getByLabel("Find identity record").fill("Child");
  await identity.getByRole("button", { name: "Search", exact: true }).click();
  await identity.getByRole("button", { name: /Child E2E Patient/ }).click();
  await identity.getByLabel("Given name", { exact: true }).fill("Child");
  await identity.getByLabel("Family name", { exact: true }).fill("Browser Correction");
  await identity.getByLabel("Or estimated age").fill("8");
  await identity.getByLabel("Sex at birth", { exact: true }).selectOption("FEMALE");
  await identity.getByLabel("Identifier type").selectOption("BIRTH_CERTIFICATE");
  await identity.getByLabel("Identifier value").fill("BROWSER-CHILD-IDENTITY-1");
  await identity.getByLabel("Evidence reference").fill("BROWSER-SYNTHETIC-DOCUMENT-1");
  await identity.getByLabel("Reason for this correction").fill("Synthetic document review for browser identity correction test");
  await identity.getByRole("button", { name: "Record reviewed correction" }).click();
  await expect(identity.getByRole("button", { name: "Reverse latest correction" })).toBeVisible();
  await identity.getByLabel("Reason for reversing this correction").fill("Restore synthetic demographics after browser verification");
  await identity.getByRole("button", { name: "Reverse latest correction" }).click();
  await expect(identity.getByText(/Synthetic document review.*Reversed/)).toBeVisible();
  await expect(identity.getByRole("button", { name: "Reverse latest correction" })).toHaveCount(0);
});
