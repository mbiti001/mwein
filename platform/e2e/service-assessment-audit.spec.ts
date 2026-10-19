import { test, expect, type Page } from "@playwright/test";

// API-intercepted audit of the existing UI. Known-gap assertions describe the
// baseline only; replace them when SERVICE-ASSESSMENT-AUDIT.md is implemented.
const visitId = "11111111-1111-4111-8111-111111111111";
const data = { serviceRequested: "Screening", requestDetails: "Synthetic request", safetyScreen: "Synthetic checks", carePlan: "Saved synthetic plan" };
const record = { id: "record-a", servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", data, riskLevel: "ROUTINE", followUpAt: null, updatedAt: "2026-10-19T20:00:00Z", updatedById: "synthetic-author", updatedBy: { displayName: "Synthetic Recorder" } };
const visit = { id: visitId, visitNumber: "V-AUDIT-001", clinic: "Walk-in", priority: "ROUTINE", status: "UNDER_CONSULTATION", arrivedAt: "2026-10-19T18:00:00Z", patient: { id: "patient-a", patientNumber: "P-AUDIT-001", fullName: "Synthetic Assessment Patient", sexAtBirth: "UNKNOWN", allergies: [] }, encounters: [], orders: [] };
type State = { saved: typeof record | null; readFailure: boolean; saveStatus: number; refreshFailure: boolean; encounterStatus: string; posts: any[] };
async function fixture(page: Page, options: Partial<State> = {}, authorized = true) {
  const state: State = { saved: structuredClone(record), readFailure: false, saveStatus: 200, refreshFailure: false, encounterStatus: "DRAFT", posts: [], ...options };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Audit operator", email: "audit@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: authorized ? ["visit.read", "patient.read", "encounter.write", "admin.dashboard"] : ["visit.read", "patient.read"], roles: ["TEST"], mustChangePassword: false, mfaRequired: false } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [visit] } }));
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  await page.route("**/api/service-points*", async route => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON(); state.posts.push(body);
      if (state.saveStatus !== 200) return route.fulfill({ status: state.saveStatus, json: { error: "Synthetic save conflict" } });
      state.saved = { ...record, data: body.data, riskLevel: body.riskLevel, updatedAt: "2026-10-19T20:10:00Z" };
      return route.fulfill({ json: { record: state.saved } });
    }
    if (request.url().includes("visitId=")) return route.fulfill(state.readFailure ? { status: 503, json: { error: "Synthetic assessment load failed" } } : { json: { record: state.saved, encounterStatus: state.encounterStatus, relationships: [] } });
    return route.fulfill(state.refreshFailure && state.posts.length ? { status: 503, json: { error: "Synthetic metrics refresh failed" } } : { json: { metrics: {} } });
  });
  await page.goto("/");
  if (authorized) {
    await page.getByRole("button", { name: "Service points", exact: true }).click();
    await page.locator(".careServiceCard").filter({ has: page.locator("strong", { hasText: /^Walk-in$/ }) }).click();
    await page.getByRole("button", { name: /Synthetic Assessment Patient/ }).click();
    await expect(page.getByLabel("Follow-up, escalation or referral plan")).toBeVisible();
  }
  return state;
}
const plan = (page: Page) => page.getByLabel("Follow-up, escalation or referral plan");
const save = (page: Page) => page.getByRole("button", { name: "Save Walk-in assessment", exact: true });

test("saved snapshot stays separate from edits; current save payload lacks a record revision", async ({ page }) => {
  const state = await fixture(page);
  await plan(page).fill("Unsaved synthetic plan");
  await expect(page.locator(".savedAssessment")).toContainText("Saved synthetic plan");
  await expect(page.locator(".savedAssessment")).not.toContainText("Unsaved synthetic plan");
  await save(page).click();
  await expect(page.locator(".savedAssessment")).toContainText("Unsaved synthetic plan");
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toEqual({ action: "SAVE_ASSESSMENT", visitId, servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", data: { ...data, carePlan: "Unsaved synthetic plan" }, riskLevel: "ROUTINE" });
});

test("known gap: failed initial assessment read leaves an editable save form", async ({ page }) => {
  const state = await fixture(page, { readFailure: true });
  await expect(page.locator(".serviceAssessment .alert")).toContainText("Synthetic assessment load failed");
  await page.getByLabel("Service requested").selectOption("Screening");
  await page.getByLabel("Order, refill or service details").fill(data.requestDetails);
  await page.getByLabel("Identity, allergy, indication and immediate-risk checks").fill(data.safetyScreen);
  await plan(page).fill("Synthetic draft after failed read");
  await expect(save(page)).toBeEnabled();
  expect(state.posts).toHaveLength(0);
});

test("known gap: corrected encounter response does not make the assessment read-only", async ({ page }) => {
  const state = await fixture(page, { encounterStatus: "CORRECTED" });
  await plan(page).fill("Synthetic edit of corrected assessment");
  await expect(save(page)).toBeEnabled();
  expect(state.posts).toHaveLength(0);
});

test("save conflict retains the typed draft and original saved snapshot", async ({ page }) => {
  const state = await fixture(page, { saveStatus: 409 });
  await plan(page).fill("Retained synthetic draft");
  await save(page).click();
  await expect(page.locator(".serviceAssessment .alert")).toContainText("Synthetic save conflict");
  await expect(plan(page)).toHaveValue("Retained synthetic draft");
  await expect(page.locator(".savedAssessment")).toContainText("Saved synthetic plan");
  await expect(save(page)).toBeEnabled();
  expect(state.posts).toHaveLength(1);
});

test("successful save remains confirmed when the metrics refresh fails", async ({ page }) => {
  const state = await fixture(page, { refreshFailure: true });
  await plan(page).fill("Committed synthetic plan");
  await save(page).click();
  await expect(page.locator(".serviceAssessment .alert")).toContainText("Synthetic metrics refresh failed");
  await expect(page.locator(".serviceAssessment").getByRole("status")).toContainText("assessment saved");
  await expect(page.locator(".savedAssessment")).toContainText("Committed synthetic plan");
  await expect(save(page)).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
});

test("audit desktop tablet phone and print layout, omitted author and missing values", async ({ page }, testInfo) => {
  await fixture(page);
  const measurements: any[] = [];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 768) await expect.poll(() => page.locator("#main-navigation").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(page.locator(".savedAssessment")).toContainText("Saved synthetic plan");
    measurements.push(await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, entryColumns: getComputedStyle(document.querySelector(".serviceFields")!).gridTemplateColumns, savedColumns: getComputedStyle(document.querySelector(".savedAssessment .recordFields")!).gridTemplateColumns })));
    await page.locator(".servicePatientHeader").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`assessment-${width}.png`) });
    if (width === 1440 || width === 390) await page.locator(".savedAssessment").screenshot({ path: testInfo.outputPath(`saved-assessment-${width}.png`) });
  }
  // Baseline gaps: even supplied author data is omitted; absent fields disappear.
  await expect(page.locator(".savedAssessment")).not.toContainText("Synthetic Recorder");
  await expect(page.locator(".savedAssessment")).not.toContainText("Request source or referring clinician/facility");
  await plan(page).fill("UNSAVED PRINT AUDIT MARKER");
  await page.emulateMedia({ media: "print" });
  const print = await page.evaluate(() => ({ entryDisplay: getComputedStyle(document.querySelector(".serviceAssessment")!).display, identityDisplay: getComputedStyle(document.querySelector(".servicePatientHeader")!).display, savedDisplay: getComputedStyle(document.querySelector(".savedAssessment")!).display }));
  // Characterize the print gap: editable drafts remain present while patient identity is hidden.
  expect(print).toEqual({ entryDisplay: "grid", identityDisplay: "none", savedDisplay: "block" });
  await expect(plan(page)).toBeVisible();
  await expect(plan(page)).toHaveValue("UNSAVED PRINT AUDIT MARKER");
  await page.locator(".serviceAssessment").screenshot({ path: testInfo.outputPath("assessment-print-entry.png") });
  await page.pdf({ path: testInfo.outputPath("assessment-print.pdf"), format: "A4", printBackground: true });
  await testInfo.attach("assessment-layout-observations", { body: JSON.stringify({ measurements, print }), contentType: "application/json" });
});

test("reception-only permissions hide the assessment destination", async ({ page }) => {
  await fixture(page, {}, false);
  await expect(page.getByRole("button", { name: "Service points", exact: true })).toHaveCount(0);
});
