import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  const visit = { id: "journey", visitNumber: "V-JOURNEY", clinic: "Outpatient", status: "AWAITING_PAYMENT", priority: "ROUTINE", arrivedAt: "2026-10-16T00:00:00Z", patient: { id: "patient", fullName: "Synthetic Journey Patient", patientNumber: "P-JOURNEY" }, encounters: [{ status: "SIGNED", diagnoses: [] }], orders: [], queues: [{ servicePoint: "BILLING", status: "WAITING" }] };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Journey clinician", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["visit.read", "encounter.write"], roles: ["TEST"] } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [visit] } }));
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  return visit;
}
test("discharge review preserves entries across failures and retries the same request", async ({ page }, info) => {
  const visit = await setup(page); let posts: Record<string, unknown>[] = [], failReview = true;
  await page.route("**/api/visits/journey/discharge", async route => {
    if (route.request().method() === "GET") return route.fulfill(failReview ? { status: 503, json: { error: "Review unavailable" } } : { json: { revision: "a".repeat(64), closedAt: null, blockers: [], orders: [{ id: "order", displayName: "Synthetic imaging", status: "REQUESTED", orderedBy: { displayName: "Journey clinician" } }] } });
    posts.push(route.request().postDataJSON());
    if (posts.length === 1) return route.abort("failed");
    return route.fulfill({ json: { visit: { clinicallyClosedAt: "2026-10-16T01:00:00Z" }, disposition: { outcome: "OUTPATIENT", details: posts[1].details, recordedById: "Synthetic clinician reference" }, financialReviewRequired: true, replayed: true } });
  });
  await page.goto("/");
  const panel = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Clinical discharge", exact: true }) });
  await panel.getByLabel("Patient and visit").selectOption(visit.id);
  await expect(panel.getByRole("alert")).toContainText("Review unavailable");
  await expect(panel.getByRole("button", { name: "Confirm clinical discharge" })).toBeDisabled();
  failReview = false;
  await panel.getByRole("button", { name: "Reload discharge review" }).click();
  await expect(panel.getByText("Synthetic imaging", { exact: true })).toBeVisible();
  await panel.getByLabel("Clinical outcome").selectOption("OUTPATIENT");
  await panel.getByLabel("Closure summary, follow-up and handover").fill("Synthetic cancellation reason and follow-up plan");
  await expect(panel.getByRole("button", { name: "Confirm clinical discharge" })).toBeDisabled();
  await panel.getByRole("checkbox").check();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await panel.getByRole("checkbox").boundingBox())!.width).toBeLessThanOrEqual(20);
    await panel.screenshot({ path: info.outputPath(`discharge-review-${width}.png`) });
  }
  await panel.getByRole("button", { name: "Confirm clinical discharge" }).click();
  await expect(panel.getByRole("alert")).toContainText("Your entries are retained");
  await expect(panel.getByLabel("Closure summary, follow-up and handover")).toHaveValue("Synthetic cancellation reason and follow-up plan");
  await panel.getByRole("button", { name: "Confirm clinical discharge" }).click();
  await expect(panel.getByRole("status")).toContainText("Clinical closure recorded");
  expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
  await expect(panel.getByRole("heading", { name: "Recorded discharge" })).toBeVisible();
  await expect(panel.getByText("Synthetic clinician reference", { exact: true })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(panel.getByText("Synthetic cancellation reason and follow-up plan", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("recorded-discharge-print.png"), fullPage: true });
  await page.pdf({ path: info.outputPath("recorded-discharge.pdf"), format: "A4" });
});

test("discharge does not act on a stale response for another patient", async ({ page }) => {
  const visit = await setup(page);
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [visit, { ...visit, id: "second", visitNumber: "V-SECOND", patient: { ...visit.patient, fullName: "Second Synthetic Patient" } }] } }));
  await page.route("**/api/visits/*/discharge", async route => {
    if (route.request().url().includes("journey/")) { await new Promise(resolve => setTimeout(resolve, 500)); return route.fulfill({ json: { revision: "a".repeat(64), orders: [], blockers: [] } }).catch(() => {}); }
    return route.fulfill({ json: { revision: "b".repeat(64), orders: [], blockers: ["Resolve in-progress services before closure"] } });
  });
  await page.goto("/");
  const panel=page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Clinical discharge", exact: true }) });
  await panel.getByLabel("Patient and visit").selectOption("journey");
  page.on("dialog", dialog => dialog.accept());
  await panel.getByLabel("Patient and visit").selectOption("second");
  await expect(panel.getByRole("alert")).toContainText("Resolve in-progress services");
  await page.waitForTimeout(600);
  await expect(panel.getByRole("button", { name: "Confirm clinical discharge" })).toBeDisabled();
  await expect(panel.getByRole("alert")).toContainText("Resolve in-progress services");
});
