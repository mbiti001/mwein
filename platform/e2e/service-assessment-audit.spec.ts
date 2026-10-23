import { test, expect, type Page } from "@playwright/test";

// API-intercepted UI regressions. Native lifecycle checks run separately in
// e2e-assessment-lifecycle.mjs; revision races run separately in the native fixture.
const visitId = "11111111-1111-4111-8111-111111111111";
const data = { serviceRequested: "Screening", requestDetails: "Synthetic request", safetyScreen: "Synthetic checks", carePlan: "Saved synthetic plan" };
const record = { id: "record-a", servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", data, riskLevel: "ROUTINE", followUpAt: null, updatedAt: "2026-10-19T20:00:00Z", updatedById: "synthetic-author", updatedBy: { displayName: "Synthetic Recorder" } };
const visit = { id: visitId, visitNumber: "V-AUDIT-001", clinic: "Walk-in", priority: "ROUTINE", status: "UNDER_CONSULTATION", arrivedAt: "2026-10-19T18:00:00Z", patient: { id: "patient-a", patientNumber: "P-AUDIT-001", fullName: "Synthetic Assessment Patient", sexAtBirth: "UNKNOWN", allergies: [] }, encounters: [], orders: [] };
const narrative = { id: "addendum-a", encounterId: "older-signed-encounter", text: "Saved synthetic narrative clarification", reason: "Clarify the recorded plan", createdAt: "2026-10-21T08:00:00Z", author: { displayName: "Synthetic Amendments Author" } };
type State = { saved: typeof record | null; addenda?: { items: (typeof narrative)[]; hasMore: boolean; limit: number }; readFailure: boolean; saveStatus: number; refreshFailure: boolean; encounterStatus: string; readOnly: boolean; revision: string | null; posts: any[] };
async function fixture(page: Page, options: Partial<State> = {}, authorized = true) {
  const state: State = { saved: structuredClone(record), addenda: { items: [], hasMore: false, limit: 20 }, readFailure: false, saveStatus: 200, refreshFailure: false, encounterStatus: "DRAFT", readOnly: false, revision: "a".repeat(64), posts: [], ...options };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Audit operator", email: "audit@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: authorized ? ["visit.read", "patient.read", "encounter.write", "admin.dashboard"] : ["visit.read", "patient.read"], roles: ["TEST"], mustChangePassword: false, mfaRequired: false } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [visit] } }));
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  await page.route("**/api/service-points*", async route => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON(); state.posts.push(body);
      if (state.saveStatus !== 200) return route.fulfill({ status: state.saveStatus, json: { error: "Synthetic save conflict" } });
      state.saved = { ...record, data: body.data, riskLevel: body.riskLevel, updatedAt: "2026-10-19T20:10:00Z" };
      state.revision = "b".repeat(64);
      return route.fulfill({ json: { record: state.saved, assessmentRevision: state.revision } });
    }
    if (request.url().includes("visitId=")) return route.fulfill(state.readFailure ? { status: 503, json: { error: "Synthetic assessment load failed" } } : { json: { record: state.saved, addenda: state.addenda, assessmentRevision: state.revision, encounterStatus: state.encounterStatus, readOnly: state.readOnly, visitStatus: visit.status, relationships: [] } });
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

// Default print remains the current snapshot; selected history prints separately.
test("reviewed edit and default print expose current snapshot without earlier saved text", async ({ page }) => {
  const state = await fixture(page);
  await plan(page).fill("Replacement history audit plan");
  await save(page).click();
  await expect(page.locator(".savedAssessment")).toContainText("Replacement history audit plan");
  await expect(page.locator(".savedAssessment")).not.toContainText(data.carePlan);
  expect(state.posts).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "Service points", exact: true }).click();
  await page.locator(".careServiceCard").filter({ has: page.locator("strong", { hasText: /^Walk-in$/ }) }).click();
  await page.getByRole("button", { name: /Synthetic Assessment Patient/ }).click();
  await expect(page.locator(".savedAssessment")).toContainText("Replacement history audit plan");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".savedAssessment")).toContainText("Replacement history audit plan");
  await expect(page.locator(".savedAssessment")).not.toContainText(data.carePlan);
});

test("corrected worksheet exposes saved narratives while keeping amendment entry unavailable", async ({ page }) => {
  const state = await fixture(page, { encounterStatus: "CORRECTED", readOnly: true, addenda: { items: [narrative], hasMore: false, limit: 20 } });
  await expect(plan(page)).toBeDisabled();
  await expect(page.locator(".serviceAssessment").getByRole("button", { name: /addendum|amend|history|revision/i })).toHaveCount(0);
  await expect(page.locator(".savedAssessment")).toContainText("Synthetic Recorder");
  await expect(page.locator(".assessmentAddenda")).toContainText(narrative.text);
  await expect(page.locator(".assessmentAddenda")).toContainText(narrative.encounterId);
  expect(state.posts).toHaveLength(0);
});

test("narrative history preserves attribution, wrapping and explicit print truncation", async ({ page }, testInfo) => {
  const longText = Array.from({ length: 75 }, (_, i) => `Narrative line ${i + 1}: synthetic saved observation.`).join("\n");
  const state = await fixture(page, { addenda: { items: [{ ...narrative, text: longText, encounterId: "synthetic-" + "reference".repeat(18) }], hasMore: true, limit: 20 } });
  const history = page.getByRole("region", { name: "Saved narrative addenda" });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 768) await expect.poll(() => page.locator("#main-navigation").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(history).toContainText(narrative.author.displayName);
    await expect(history).toContainText("Africa/Nairobi");
    await expect(history).toContainText(narrative.reason);
    await expect(history).toContainText("Older addenda are omitted from this view and printout");
    // Element screenshots scroll a tall region into view and capture the fixed
    // mobile header over its text. Capture document coordinates from the top.
    await page.evaluate(() => window.scrollTo(0, 0));
    const bounds = await history.boundingBox();
    expect(bounds).not.toBeNull();
    await page.screenshot({ path: testInfo.outputPath(`narrative-history-${width}.png`), fullPage: true, clip: bounds! });
  }
  await plan(page).fill("UNSAVED NARRATIVE PRINT MARKER");
  await page.emulateMedia({ media: "print" });
  await expect(history).toBeVisible();
  await expect(history).toContainText("P-AUDIT-001 · V-AUDIT-001");
  await expect(history).toContainText("Narrative line 75:");
  await expect(plan(page)).toBeHidden();
  await page.pdf({ path: testInfo.outputPath("narrative-history.pdf"), format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  expect(state.posts).toHaveLength(0);
});

test("failed narrative read never claims there are no addenda; keyboard retry recovers", async ({ page }) => {
  const state = await fixture(page, { readFailure: true, addenda: { items: [narrative], hasMore: false, limit: 20 } });
  const history = page.locator(".assessmentAddenda");
  await expect(history).toContainText("Narrative addenda unavailable");
  await expect(history).not.toContainText("No narrative addenda recorded");
  await page.emulateMedia({ media: "print" });
  await expect(history).toBeVisible();
  await expect(history).toContainText("unavailable");
  await page.emulateMedia({ media: "screen" });
  state.readFailure = false;
  await page.getByRole("button", { name: "Retry assessment load" }).focus();
  await page.keyboard.press("Enter");
  await expect(history).toContainText(narrative.text);
  await expect(history).not.toContainText("unavailable");
  expect(state.posts).toHaveLength(0);
});

test("narratives remain visible without a current structured record and label missing values", async ({ page }) => {
  await fixture(page, { saved: null, readOnly: true, addenda: { items: [{ ...narrative, reason: "", author: { displayName: "" } }], hasMore: false, limit: 20 } });
  const history = page.locator(".assessmentAddenda");
  await expect(history).toContainText(narrative.text);
  await expect(history).toContainText("Recorder not available");
  await expect(history).toContainText("Not recorded");
  await page.emulateMedia({ media: "print" });
  await expect(history).toBeVisible();
  await expect(page.locator(".assessmentPrintEmpty")).toBeVisible();
});

test("saved snapshot stays separate from edits; save binds to the original record revision", async ({ page }) => {
  const state = await fixture(page);
  await plan(page).fill("Unsaved synthetic plan");
  await expect(page.locator(".savedAssessment")).toContainText("Saved synthetic plan");
  await expect(page.locator(".savedAssessment")).not.toContainText("Unsaved synthetic plan");
  await save(page).click();
  await expect(page.locator(".savedAssessment")).toContainText("Unsaved synthetic plan");
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toEqual({ action: "SAVE_ASSESSMENT", visitId, expectedRevision: "a".repeat(64), servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0", data: { ...data, carePlan: "Unsaved synthetic plan" }, riskLevel: "ROUTINE" });
});

test("failed initial read disables writes; keyboard retry restores the saved record", async ({ page }) => {
  const state = await fixture(page, { readFailure: true });
  await expect(page.locator(".serviceAssessment .alert")).toContainText("Synthetic assessment load failed");
  await expect(plan(page)).toBeDisabled();
  await expect(save(page)).toBeDisabled();
  expect(state.posts).toHaveLength(0);
  state.readFailure = false;
  await page.getByRole("button", { name: "Retry assessment load" }).focus();
  await page.keyboard.press("Enter");
  await expect(plan(page)).toBeEnabled();
  await expect(plan(page)).toHaveValue(data.carePlan);
  await expect(page.locator(".serviceAssessment .alert")).toHaveCount(0);
  await expect(page.locator(".savedAssessment")).toContainText("Synthetic Recorder");
});

for (const lifecycle of [{ encounterStatus: "CORRECTED" }, { encounterStatus: "SIGNED" }, { readOnly: true }]) {
  test(`final or closed assessment is read-only: ${JSON.stringify(lifecycle)}`, async ({ page }) => {
    const state = await fixture(page, lifecycle);
    await expect(plan(page)).toBeDisabled();
    await expect(page.getByText("Read-only assessment:", { exact: false })).toBeVisible();
    await expect(page.locator(".savedAssessment")).toContainText(data.carePlan);
    expect(state.posts).toHaveLength(0);
  });
}

test("save conflict retains the typed draft and original saved snapshot", async ({ page }) => {
  const state = await fixture(page, { saveStatus: 409 });
  await plan(page).fill("Retained synthetic draft");
  await save(page).click();
  await expect(page.locator(".serviceAssessment .alert")).toContainText("Synthetic save conflict");
  await expect(plan(page)).toHaveValue("Retained synthetic draft");
  await expect(page.locator(".savedAssessment")).toContainText("Saved synthetic plan");
  await expect(save(page)).toBeDisabled();
  expect(state.posts).toHaveLength(1);
});

test("conflict review preserves entries until explicit replacement and uses the reviewed revision", async ({ page }, testInfo) => {
  const state = await fixture(page, { saveStatus: 409 });
  await plan(page).fill("Retained older draft");
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  state.saved = { ...record, data: { ...data, carePlan: "Newer saved plan" } };
  state.revision = "c".repeat(64);
  state.readFailure = true;
  await page.getByRole("button", { name: "Review latest saved assessment" }).click();
  await expect(page.locator(".serviceAssessment .alert")).toContainText("Synthetic assessment load failed");
  await expect(plan(page)).toHaveValue("Retained older draft");
  await expect(save(page)).toBeDisabled();
  state.readFailure = false;
  await page.getByRole("button", { name: "Review latest saved assessment" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".savedAssessment")).toContainText("Newer saved plan");
  await expect(plan(page)).toHaveValue("Retained older draft");
  await expect(save(page)).toBeDisabled();
  expect(state.posts).toHaveLength(1);
  const replace = page.getByRole("button", { name: "Replace my entries with saved assessment" });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 768) await expect.poll(() => page.locator("#main-navigation").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(replace).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`assessment-conflict-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".serviceAssessment")).toBeHidden();
  await expect(page.locator(".savedAssessment")).toContainText("Newer saved plan");
  await expect(page.locator(".savedAssessment")).not.toContainText("Retained older draft");
  await page.emulateMedia({ media: "screen" });
  page.once("dialog", dialog => dialog.dismiss());
  await replace.click();
  await expect(plan(page)).toHaveValue("Retained older draft");
  page.once("dialog", dialog => dialog.accept());
  await replace.click();
  await expect(plan(page)).toHaveValue("Newer saved plan");
  state.saveStatus = 200;
  await plan(page).fill("Reviewed new edit");
  await save(page).click();
  await expect(page.locator(".savedAssessment")).toContainText("Reviewed new edit");
  expect(state.posts[0].expectedRevision).toBe("a".repeat(64));
  expect(state.posts[1].expectedRevision).toBe("c".repeat(64));
});

test("ambiguous response requires review without automatic resubmission", async ({ page }) => {
  const state = await fixture(page, { saveStatus: 503 });
  await plan(page).fill("Unconfirmed synthetic plan");
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  await expect(plan(page)).toHaveValue("Unconfirmed synthetic plan");
  await page.getByRole("button", { name: "Review latest saved assessment" }).click();
  await expect(page.getByRole("button", { name: "Replace my entries with saved assessment" })).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test("missing server revision fails closed before editing", async ({ page }) => {
  const state = await fixture(page, { revision: undefined });
  await expect(page.locator(".serviceAssessment .alert")).toContainText("revision is unavailable");
  await expect(plan(page)).toBeDisabled();
  expect(state.posts).toHaveLength(0);
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

test("aligned desktop tablet phone and saved-only print retain identity author and missing values", async ({ page }, testInfo) => {
  await fixture(page);
  const measurements: any[] = [];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 768) await expect.poll(() => page.locator("#main-navigation").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(page.locator(".savedAssessment")).toContainText("Saved synthetic plan");
    measurements.push(await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, entryColumns: getComputedStyle(document.querySelector(".serviceFields")!).gridTemplateColumns, savedColumns: getComputedStyle(document.querySelector(".savedAssessment .recordFields")!).gridTemplateColumns })));
    const last = measurements.at(-1);
    expect(last.entryColumns.split(" ").length).toBe(last.savedColumns.split(" ").length);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`assessment-${width}.png`), fullPage: true });
    if (width === 1440) await page.locator(".savedAssessment").screenshot({ path: testInfo.outputPath(`saved-assessment-${width}.png`) });
  }
  await expect(page.locator(".savedAssessment")).toContainText("Synthetic Recorder");
  await expect(page.locator(".savedAssessment")).toContainText("Request source or referring clinician/facility");
  await expect(page.locator(".savedAssessment")).toContainText("Not recorded");
  await plan(page).fill("UNSAVED PRINT AUDIT MARKER");
  await page.emulateMedia({ media: "print" });
  const print = await page.evaluate(() => ({ entryDisplay: getComputedStyle(document.querySelector(".serviceAssessment")!).display, identityDisplay: getComputedStyle(document.querySelector(".servicePatientHeader")!).display, savedDisplay: getComputedStyle(document.querySelector(".savedAssessment")!).display }));
  expect(print).toEqual({ entryDisplay: "none", identityDisplay: "none", savedDisplay: "block" });
  await expect(plan(page)).toBeHidden();
  await expect(plan(page)).toHaveValue("UNSAVED PRINT AUDIT MARKER");
  await expect(page.locator(".savedAssessment .assessmentIdentity")).toBeVisible();
  await expect(page.locator(".savedAssessment")).toContainText("P-AUDIT-001 · V-AUDIT-001");
  await page.locator(".savedAssessment").screenshot({ path: testInfo.outputPath("assessment-print-saved.png") });
  await page.pdf({ path: testInfo.outputPath("assessment-print.pdf"), format: "A4", printBackground: true });
  await testInfo.attach("assessment-layout-observations", { body: JSON.stringify({ measurements, print }), contentType: "application/json" });
});

test("long saved assessment prints across pages without unsaved text", async ({ page }, testInfo) => {
  const longPlan = Array.from({ length: 90 }, (_, i) => `Saved line ${i + 1}: synthetic follow-up observation.`).join("\n");
  await fixture(page, { saved: { ...record, data: { ...data, carePlan: longPlan } } });
  await plan(page).fill("UNSAVED MULTIPAGE MARKER");
  await page.pdf({ path: testInfo.outputPath("assessment-multipage.pdf"), format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
});

test("reception-only permissions hide the assessment destination", async ({ page }) => {
  await fixture(page, {}, false);
  await expect(page.getByRole("button", { name: "Service points", exact: true })).toHaveCount(0);
});

const snapshot = (version: number, overrides: Record<string, unknown> = {}) => ({
  id: `snapshot-${version}`, version, previousVersion: version > 1 ? version - 1 : null,
  kind: version === 1 ? "MIGRATION_BASELINE" : "DRAFT_SAVE", servicePoint: "WALK_IN", templateVersion: record.templateVersion,
  data: { ...data, carePlan: `Retained plan ${version}` }, riskLevel: "ROUTINE", followUpAt: null,
  sourceCreatedAt: "2026-10-18T08:00:00Z", sourceUpdatedAt: "2026-10-19T08:00:00Z", capturedAt: "2026-10-22T08:00:00Z",
  recordedBy: { id: "synthetic-author", displayName: "History Recorder" }, sessionAttribution: version === 1 ? "NOT_AVAILABLE" : "RECORDED", ...overrides,
});
async function historyFixture(page: Page, options: Partial<State> = {}) {
  const state = await fixture(page, options);
  const history = { status: 200, requests: [] as string[], items: [snapshot(22), snapshot(21)], older: [snapshot(1)], hasMore: true, responseVisitId: visitId };
  await page.route("**/api/service-points/history?**", async route => {
    history.requests.push(route.request().url());
    const older = new URL(route.request().url()).searchParams.has("beforeVersion");
    return route.fulfill({ status: history.status, json: history.status !== 200 ? { error: "Synthetic history unavailable" } : {
      visitId: history.responseVisitId, recordId: record.id, encounterId: "encounter-history", items: older ? history.older : history.items,
      hasMore: !older && history.hasMore, nextBeforeVersion: !older && history.hasMore ? 21 : null,
    } });
  });
  return { state, history, region: page.getByRole("region", { name: "Structured assessment history", exact: true }) };
}

test("structured history loads on demand, pages with stable cursors and retains the editable draft", async ({ page }) => {
  const { state, history, region } = await historyFixture(page);
  expect(history.requests).toHaveLength(0);
  await plan(page).fill("UNSAVED HISTORY DRAFT");
  await region.getByRole("button", { name: "Load saved versions" }).click();
  await region.getByRole("combobox", { name: "Saved version", exact: true }).selectOption("snapshot-21");
  await expect(region.getByRole("article")).toContainText("Retained plan 21");
  await expect(region).toContainText("History Recorder");
  await expect(region).toContainText("Africa/Nairobi");
  await region.getByRole("button", { name: "Older versions", exact: true }).click();
  await region.getByRole("combobox", { name: "Saved version", exact: true }).selectOption("snapshot-1");
  await expect(region).toContainText("Migration baseline: values retained when history capture began");
  await expect(region.getByRole("article")).toContainText("Not available");
  expect(history.requests.at(-1)).toContain("beforeVersion=21");
  await expect(region.getByRole("button", { name: "Older versions", exact: true })).toHaveCount(0);
  await region.getByRole("button", { name: "Newer versions", exact: true }).click();
  await expect(region.getByRole("combobox", { name: "Saved version", exact: true })).toHaveValue("");
  await expect(plan(page)).toHaveValue("UNSAVED HISTORY DRAFT");
  expect(state.posts).toHaveLength(0);
});

test("failed older page clears selected print data and keyboard retry uses the same cursor", async ({ page }) => {
  const { history, region } = await historyFixture(page);
  await region.getByRole("button", { name: "Load saved versions" }).click();
  await region.getByRole("combobox", { name: "Saved version", exact: true }).selectOption("snapshot-22");
  await region.getByLabel("Use this version for printing").check();
  history.status = 503;
  await region.getByRole("button", { name: "Older versions", exact: true }).click();
  await expect(region).toContainText("Structured history unavailable");
  await expect(region).not.toContainText("No retained snapshots");
  await expect(region.getByRole("article")).toHaveCount(0);
  await expect(page.locator(".historyPrintSelected")).toHaveCount(0);
  history.status = 200;
  await region.getByRole("button", { name: "Retry history load" }).focus();
  await page.keyboard.press("Enter");
  await region.getByRole("combobox", { name: "Saved version", exact: true }).selectOption("snapshot-1");
  expect(history.requests.slice(-2).every(url => url.includes("beforeVersion=21"))).toBe(true);
  await expect(region).toContainText("Retained plan 1");
});

test("empty, denied and mismatched history never disclose selected snapshots", async ({ page }) => {
  const { history, region } = await historyFixture(page);
  history.items = []; history.hasMore = false;
  await region.getByRole("button", { name: "Load saved versions" }).click();
  await expect(region).toContainText("No retained snapshots on this page");
  await expect(region.getByRole("combobox", { name: "Saved version", exact: true })).toHaveCount(0);
  for (const status of [401, 403, 404, 500]) {
    history.status = status;
    await region.getByRole("button", { name: "Reload latest history" }).click();
    await expect(region).toContainText("Structured history unavailable");
    await expect(region).not.toContainText("No retained snapshots");
    await expect(region.getByRole("article")).toHaveCount(0);
  }
  history.status = 200; history.items = [snapshot(2)]; history.responseVisitId = "different-visit";
  await region.getByRole("button", { name: "Reload latest history" }).click();
  await expect(region).toContainText("does not match this assessment");
  await expect(region.getByRole("article")).toHaveCount(0);
});

test("saved assessment change invalidates history selection and print target", async ({ page }) => {
  const { region } = await historyFixture(page);
  await region.getByRole("button", { name: "Load saved versions" }).click();
  await region.getByRole("combobox", { name: "Saved version", exact: true }).selectOption("snapshot-22");
  await region.getByLabel("Use this version for printing").check();
  await plan(page).fill("Newly saved plan after history review");
  await save(page).click();
  await expect(page.locator(".savedAssessment")).toContainText("Newly saved plan after history review");
  await expect(region.getByRole("button", { name: "Load saved versions" })).toBeVisible();
  await expect(region.getByRole("article")).toHaveCount(0);
  await expect(page.locator(".historyPrintSelected")).toHaveCount(0);
});

test("selected retained version aligns across viewports and prints only its saved content", async ({ page }, testInfo) => {
  const { state, history, region } = await historyFixture(page, { encounterStatus: "CORRECTED", readOnly: true, addenda: { items: [narrative], hasMore: false, limit: 20 } });
  const longPlan = Array.from({ length: 80 }, (_, index) => `Historical line ${index + 1}: synthetic retained observation.`).join("\n");
  history.items = [snapshot(1, { data: { ...data, carePlan: longPlan, retainedZero: 0, retainedNegative: false }, recordedBy: { id: "original-recorder", displayName: "" } })]; history.hasMore = false;
  await region.getByRole("button", { name: "Load saved versions" }).click();
  await region.getByRole("combobox", { name: "Saved version", exact: true }).selectOption("snapshot-1");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 768) await expect.poll(() => page.locator("#main-navigation").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(region).toContainText("Recorder not available");
    await expect(region).toContainText("Not recorded");
    await expect(region.locator("dd").filter({ hasText: /^0$/ })).toHaveCount(1);
    await expect(region.locator("dd").filter({ hasText: /^No$/ })).toHaveCount(1);
    const columns = await region.locator(".recordFields").first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width > 650 ? 2 : 1);
    await page.evaluate(() => window.scrollTo(0, 0));
    const bounds = await region.boundingBox();
    await page.screenshot({ path: testInfo.outputPath(`structured-history-${width}.png`), fullPage: true, clip: bounds! });
  }
  await page.emulateMedia({ media: "print" });
  await expect(region).toBeHidden();
  await expect(page.locator(".savedAssessment")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await region.getByLabel("Use this version for printing").check();
  await page.evaluate(() => { window.print = () => { document.documentElement.dataset.printInvoked = "yes"; }; });
  await region.getByRole("button", { name: "Print selected version" }).click();
  expect(await page.locator("html").getAttribute("data-print-invoked")).toBe("yes");
  await page.emulateMedia({ media: "print" });
  await expect(region).toBeVisible();
  await expect(page.locator(".savedAssessment")).toBeHidden();
  await expect(page.locator(".assessmentAddenda")).toBeHidden();
  await expect(plan(page)).toBeHidden();
  await expect(region.getByRole("button", { name: "Print selected version" })).toBeHidden();
  await expect(region.getByRole("article")).toContainText("P-AUDIT-001 · V-AUDIT-001");
  await page.pdf({ path: testInfo.outputPath("selected-history.pdf"), format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  await page.screenshot({ path: testInfo.outputPath("selected-history-print.png"), fullPage: true });
  expect(state.posts).toHaveLength(0);
});

test("unknown historical template keeps original keys and values without relabeling", async ({ page }) => {
  const { history, region } = await historyFixture(page);
  history.items = [snapshot(3, { templateVersion: "RETIRED-TEMPLATE", data: { retiredField: "Original retained text", carePlan: "Old key meaning" } })]; history.hasMore = false;
  await region.getByRole("button", { name: "Load saved versions" }).click();
  await region.getByRole("combobox", { name: "Saved version", exact: true }).selectOption("snapshot-3");
  await expect(region).toContainText("original field keys");
  await expect(region).toContainText("retiredField");
  await expect(region).toContainText("Original retained text");
  await expect(region).not.toContainText("Follow-up, escalation or referral plan");
});

test("leaving the patient while history is pending discards the response", async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/service-points/history?**", async route => {
    await pending;
    await route.fulfill({ json: { visitId, recordId: record.id, encounterId: "old", items: [snapshot(1)], hasMore: false, nextBeforeVersion: null } }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Load saved versions" }).click();
  await expect(page.getByText("Loading saved versions…")).toBeVisible();
  await page.getByRole("button", { name: "← Queue", exact: true }).click();
  release();
  await page.getByRole("button", { name: /Synthetic Assessment Patient/ }).click();
  await expect(page.getByRole("button", { name: "Load saved versions" })).toBeVisible();
  await expect(page.getByText("Retained plan 1", { exact: true })).toHaveCount(0);
});
