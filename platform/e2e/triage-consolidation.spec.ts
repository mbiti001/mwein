import { test, expect, type Page } from "@playwright/test";
const stamp = "2026-01-01T09:00:00.000Z";
const values = { temperatureC: 37.2, pulseBpm: 84, respiratoryRate: 18, systolicBp: 118, diastolicBp: 76, oxygenSaturation: 98, weightKg: 70, heightCm: 172 };
function visit(id = "11111111-1111-4111-8111-111111111111", name = "Synthetic Triage Patient", status = "AWAITING_TRIAGE") { return { id, visitNumber: `V-${id.slice(0,4)}`, clinic: "Outpatient", status, priority: "ROUTINE", arrivedAt: stamp, patient: { id, fullName: name, patientNumber: `P-${id.slice(0,4)}`, sexAtBirth: "MALE", estimatedAgeYears: 30, allergies: [] } }; }
const measured = { id: "22222222-2222-4222-8222-222222222222", measuredAt: stamp, recordedAt: stamp, values, recordedBy: { displayName: "Synthetic Reception Recorder" }, note: null };
async function setup(page: Page, permissions = ["triage.write", "vitals.write"], status = "AWAITING_TRIAGE") {
  const state = { visits: [visit(undefined, undefined, status), visit("33333333-3333-4333-8333-333333333333", "Synthetic Second Patient")], history: [measured], failHistory: false, failVisits: false };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Synthetic Nurse", email: "test@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["visit.read", ...permissions], mustChangePassword: false, mfaRequired: false, mfaEnrolled: false } } }));
  await page.route("**/api/visits", route => route.fulfill(state.failVisits ? { status: 503, json: { error: "Worklist unavailable" } } : { json: { visits: state.visits } }));
  await page.route("**/api/visits/*/vitals", route => route.fulfill(state.failHistory ? { status: 503, json: { error: "History unavailable" } } : { json: { measurements: state.history, truncated: false } }));
  await page.goto("/"); await page.getByRole("button", { name: "Triage", exact: true }).click();
  await expect(page.getByRole("button", { name: "Vitals", exact: true })).toHaveCount(0);
  return state;
}
async function open(page: Page) { await page.getByRole("button", { name: "Open Synthetic Triage Patient", exact: true }).click(); }
async function assessment(page: Page) {
  await page.getByLabel("Presenting concern / immediate red flag *").fill("Synthetic assessment only");
  await page.getByLabel("Pain /10").fill("2"); await page.getByLabel("Consciousness").selectOption("ALERT");
  await page.getByLabel("Triage category *").selectOption("ROUTINE");
}
for (const touched of [false, true]) test(`delayed saved readings ${touched ? "preserve measured draft edits" : "auto-load without clearing clinical assessment"}`, async ({ page }) => {
  await setup(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/visits/*/vitals", async route => { await gate; await route.fulfill({ json: { measurements: [measured], truncated: false } }); });
  await open(page); await assessment(page);
  if (touched) await page.getByLabel("Temperature °C").fill("37.7");
  release(); await expect(page.getByText("Recorded by Synthetic Reception Recorder")).toBeVisible();
  await expect(page.getByLabel("Temperature °C")).toHaveValue(touched ? "37.7" : "37.2");
  await expect(page.getByLabel("Pain /10")).toHaveValue("2"); await expect(page.getByLabel("Consciousness")).toHaveValue("ALERT");
  await expect(page.getByRole("region", { name: "Recorded vital measurements" })).toHaveCount(1);
  if (touched) {
    page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Use recorded measurements in triage" }).click();
    await expect(page.getByLabel("Temperature °C")).toHaveValue("37.7");
    page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Use recorded measurements in triage" }).click();
    await expect(page.getByLabel("Temperature °C")).toHaveValue("37.2"); await expect(page.getByLabel("Pain /10")).toHaveValue("2");
  }
});
test("one triage-only workspace reads saved sets without offering standalone measurement writes", async ({ page }) => {
  await setup(page, ["triage.write"], "AWAITING_CLINICIAN"); await open(page);
  await expect(page.getByText("Recorded by Synthetic Reception Recorder")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save measured vitals" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Complete triage" })).toHaveCount(0);
});
test("reuse preserves assessment, new-set confirmation is explicit, navigation clears only the selected visit draft", async ({ page }) => {
  await setup(page); await open(page); await assessment(page);
  await page.getByRole("button", { name: "Use recorded measurements in triage" }).click();
  await expect(page.getByLabel("Pain /10")).toHaveValue("2"); await expect(page.getByLabel("Temperature °C")).toHaveAttribute("readonly", "");
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Record a new set" }).click();
  await expect(page.getByLabel("Temperature °C")).toHaveValue("37.2");
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Record a new set" }).click();
  await expect(page.getByLabel("Temperature °C")).toHaveValue(""); await expect(page.getByLabel("Pain /10")).toHaveValue("2");
  await expect(page.getByLabel("Presenting concern / immediate red flag *")).toHaveValue("Synthetic assessment only");
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Back to queue" }).click();
  await expect(page.getByLabel("Pain /10")).toHaveValue("2");
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Back to queue" }).click();
  await page.route("**/api/visits/33333333-3333-4333-8333-333333333333/vitals", route => route.fulfill({ json: { measurements: [], truncated: false } }));
  await page.getByRole("button", { name: "Open Synthetic Second Patient" }).click();
  await expect(page.getByLabel("Temperature °C")).toHaveValue(""); await expect(page.getByLabel("Pain /10")).toHaveValue(""); await expect(page.getByLabel("Presenting concern / immediate red flag *")).toHaveValue("");
});
test("measurement retry retains the exact request and confirmed save survives history refresh failure", async ({ page }) => {
  const state = await setup(page, ["vitals.write"]); await open(page);
  const bodies: string[] = [];
  await page.route("**/api/visits/*/vitals", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(route.request().postData()!);
    if (bodies.length === 1) return route.abort("failed");
    state.failHistory = true; return route.fulfill({ status: 201, json: { measurement: { ...measured, id: "saved-retry", values: { temperatureC: 37.3 } } } });
  });
  await page.getByLabel("Temperature °C").fill("37.3"); await page.getByRole("button", { name: "Save measured vitals" }).click();
  await expect(page.getByRole("button", { name: "Retry same measurement save" })).toBeVisible(); await expect(page.getByLabel("Temperature °C")).toBeDisabled();
  await page.getByRole("button", { name: "Retry same measurement save" }).click();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]); expect(JSON.parse(bodies[0]).requestKey).toMatch(/^[\da-f-]{36}$/);
  await expect(page.getByRole("status").filter({ hasText: "Vitals saved" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "history could not refresh" })).toBeVisible();
  await expect(page.locator(".measurementSet").first()).toContainText("37.3");
  state.failHistory = false; await page.getByRole("button", { name: "Retry measurement history" }).click();
  await expect(page.getByRole("button", { name: "Retry measurement history" })).toHaveCount(0);
});
test("a confirmed triage save remains confirmed when the visit worklist fails to refresh", async ({ page }) => {
  const state = await setup(page); await open(page); await assessment(page); await page.getByRole("button", { name: "Use recorded measurements in triage" }).click();
  await page.route("**/api/visits/*/triage", route => { state.failVisits = true; return route.fulfill({ json: { visit: { id: state.visits[0].id, status: "AWAITING_CLINICIAN" } } }); });
  await page.getByRole("button", { name: "Complete triage" }).click();
  await expect(page.getByText(/Triage saved for Synthetic Triage Patient.*visit list could not refresh/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry same triage save" })).toHaveCount(0);
});
test("unified queue and assessment fit desktop tablet phone and print with recorder and missing-value labels", async ({ page }, info) => {
  const state = await setup(page); state.history = [{ ...measured, values: { ...values, heightCm: undefined } as any }];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const table = page.getByRole("region", { name: "Open visits for vitals and triage" }); await table.focus(); await page.keyboard.press("End");
    await page.screenshot({ path: info.outputPath(`triage-queue-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await open(page);
  await page.getByRole("button", { name: "Use recorded measurements in triage" }).click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByText("Recorded by Synthetic Reception Recorder")).toBeVisible(); await expect(page.getByText("Not recorded", { exact: true })).toBeVisible();
    const controls = await page.locator(".triageForm .vitalGrid input,.triageForm .vitalGrid select").evaluateAll(elements => elements.map(el => { const r=el.getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom }; }));
    for (let i=0;i<controls.length;i++) for(let j=i+1;j<controls.length;j++) { const a=controls[i],b=controls[j]; expect(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1).toBe(false); }
    await page.screenshot({ path: info.outputPath(`triage-assessment-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ media: "print" }); await page.setViewportSize({ width: 794, height: 1123 });
  await expect(page.getByRole("button", { name: "Use recorded measurements in triage" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Synthetic Triage Patient", exact: true })).toBeVisible();
  await expect(page.locator(".triageForm")).toBeHidden();
  await expect(page.getByText("Recorded by Synthetic Reception Recorder")).toBeVisible();
  await page.screenshot({ path: info.outputPath("triage-print.png"), fullPage: true });
});
