import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const make = (id: string) => ({
    id, visitNumber: `TEST-V-${id}`, priority: "ROUTINE", status: "COMPLETED", clinic: "Outpatient", arrivedAt: "2026-10-24T08:00:00Z", facility: { name: "Synthetic clinic", code: "TEST" },
    patient: { fullName: `Synthetic Patient ${id}`, patientNumber: `TEST-P-${id}`, sexAtBirth: "UNKNOWN", estimatedAgeYears: 34, allergies: [] },
    encounter: { id: `encounter-${id}`, status: "SIGNED", clinician: { displayName: "Synthetic Clinician" }, signedAt: "2026-10-24T09:00:00Z", subjective: {}, objective: {}, diagnoses: [], plan: {}, addenda: [] },
    orders: [], referrals: [], invoice: null,
  });
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Synthetic Author", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["clinical.summary.read", "encounter.write"], mustChangePassword: false, mfaRequired: false } } }));
  await page.route("**/api/visit-summaries?*", route => route.fulfill({ json: { summaries: [make("A"), make("B")] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Patient records", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic Patient A/ }).click();
  await page.getByText("Signed-note addenda", { exact: true }).click();
  const form = page.getByRole("form", { name: "Signed-note addendum" });
  await form.getByLabel("Reason *", { exact: true }).fill("Clarify synthetic entry");
  await form.getByLabel("Addendum *", { exact: true }).fill("Saved synthetic narrative for exact retry");
  return form;
}
const saved = (body: any) => ({ id: "saved-addendum", encounterId: "encounter-A", ...body, createdAt: "2026-10-24T09:10:00Z", author: { displayName: "Synthetic Author" } });

test("lost response locks the exact request and retry confirms one displayed saved narrative", async ({ page }, testInfo) => {
  const requests: any[] = [];
  await page.route("**/api/encounters/*/addenda", async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.abort("failed");
    return route.fulfill({ json: { addendum: saved(requests[0]), replayed: true } });
  });
  const form = await fixture(page);
  await form.getByRole("button", { name: "Add signed addendum" }).click();
  await expect(form.getByRole("status")).toContainText("Save not confirmed");
  await expect(page.getByText("No addenda in this loaded summary.", { exact: true })).toBeVisible();
  await expect(form.getByLabel("Reason *", { exact: true })).toHaveAttribute("readonly", "");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(form.getByRole("button", { name: "Retry unchanged addendum" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`addendum-retry-${width}.png`), fullPage: true, animations: "disabled" });
  }
  await form.getByRole("button", { name: "Retry unchanged addendum" }).click();
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  await expect(form.getByLabel("Addendum *", { exact: true })).toHaveValue("");
  const paper = page.locator(".compactVisitSummary");
  await expect(paper.locator(".summaryLine").filter({ hasText: requests[0].text })).toHaveCount(1);
  await expect(paper).toContainText("Synthetic Author");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(paper.getByText("Saved synthetic narrative for exact retry", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`addendum-saved-${width}.png`), fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  await expect(form).toBeHidden();
  await expect(paper.getByText("Saved synthetic narrative for exact retry", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("addendum-saved-print.png"), fullPage: true, animations: "disabled" });
  await page.pdf({ path: testInfo.outputPath("addendum-saved.pdf"), format: "A4", printBackground: true });
});

test("malformed success stays locked while definite initial rejection permits correction", async ({ page }) => {
  const requests: any[] = [];
  await page.route("**/api/encounters/*/addenda", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill(requests.length === 1 ? { status: 422, json: { error: "Synthetic validation rejection" } } : { status: 200, json: {} });
  });
  const form = await fixture(page);
  await form.getByRole("button", { name: "Add signed addendum" }).click();
  await expect(form.getByRole("alert")).toContainText("Synthetic validation rejection");
  await form.getByLabel("Reason *", { exact: true }).fill("Corrected synthetic reason");
  await form.getByRole("button", { name: "Add signed addendum" }).click();
  await expect(form.getByRole("status")).toContainText("Save not confirmed");
  expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
  await form.getByRole("button", { name: "Retry unchanged addendum" }).click();
  await expect(form.getByRole("button", { name: "Retry unchanged addendum" })).toBeEnabled();
  expect(requests[2]).toEqual(requests[1]);
});

test("pending save prevents duplicate submits and a late response cannot replace another patient", async ({ page }) => {
  let release!: () => void;
  let count = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/encounters/*/addenda", async route => {
    count++;
    const body = route.request().postDataJSON();
    await held;
    await route.fulfill({ status: 201, json: { addendum: saved(body) } });
  });
  const form = await fixture(page);
  await form.getByRole("button", { name: "Add signed addendum" }).click();
  await expect(form.getByRole("button", { name: "Adding…" })).toBeDisabled();
  await form.evaluate(element => (element as HTMLFormElement).requestSubmit());
  expect(count).toBe(1);
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "← Back", exact: true }).click();
  await expect(form).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "← Back", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic Patient B/ }).click();
  release();
  await expect(page.locator(".summaryIdentity")).toContainText("Synthetic Patient B");
  await expect(page.locator(".compactVisitSummary")).not.toContainText("Saved synthetic narrative for exact retry");
});
