import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function authenticate(request: APIRequestContext, email: string) {
  const origin = `http://127.0.0.1:${process.env.E2E_APP_PORT || "3210"}`;
  const response = await request.post("/api/auth/login", { headers: { origin }, data: { facilityCode: "MMS", email, password: "Mwein-E2E-Password-2026!" } });
  expect(response.status()).toBe(200);
  return { origin, cookie: response.headers()["set-cookie"].split(";")[0] };
}
const notes = { chiefComplaint: "Synthetic headache", historyPresentingIllness: "Synthetic initial history", generalExamination: "Synthetic examination", disposition: "OUTPATIENT" };

test("real consultation revisions prevent concurrent and stale overwrites and confirm a lost response", async ({ request }) => {
  const admin = await authenticate(request, "admin@mwein.local");
  const clinician = await authenticate(request, "clinician@example.test");
  const reception = await authenticate(request, "reception@example.test");
  const post = (path: string, data: object, headers = admin) => request.post(path, { headers, data });
  const patientResponse = await post("/api/patients", { givenName: "Revision", familyName: `Synthetic-${randomUUID().slice(0, 8)}`, phone: "+254700000009", estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false });
  expect(patientResponse.ok()).toBe(true); const { patient } = await patientResponse.json();
  const visitResponse = await post("/api/visits", { patientId: patient.id, clinic: "Outpatient", priority: "ROUTINE", visitType: "WALK_IN", idempotencyKey: randomUUID() });
  expect(visitResponse.ok()).toBe(true); const { visit } = await visitResponse.json();
  const path = `/api/visits/${visit.id}/consultation`;
  expect((await request.get(path, { headers: reception })).status()).toBe(403);
  expect((await post(path, { action: "SAVE_NOTES", data: notes }, clinician)).status()).toBe(428);
  const initial = await Promise.all(["First", "Second"].map(label => post(path, { action: "SAVE_NOTES", expectedRevision: null, data: { ...notes, historyPresentingIllness: `${label} simultaneous history` } }, clinician)));
  expect(initial.map(response => response.status()).sort()).toEqual([200, 409]);
  const first = await initial.find(response => response.ok())!.json();
  const changes = await Promise.all(["Third", "Fourth"].map(label => post(path, { action: "SAVE_NOTES", expectedRevision: first.draftRevision, data: { ...notes, historyPresentingIllness: `${label} simultaneous history` } }, clinician)));
  expect(changes.map(response => response.status()).sort()).toEqual([200, 409]);
  const winner = await changes.find(response => response.ok())!.json();
  const read = await request.get(path, { headers: clinician });
  expect(read.headers()["cache-control"]).toBe("private, no-store");
  const saved = (await read.json()).visit.encounters[0];
  const winningNotes = { ...notes, historyPresentingIllness: JSON.parse(saved.subjective).historyPresentingIllness };
  const retry = await post(path, { action: "SAVE_NOTES", expectedRevision: first.draftRevision, data: winningNotes }, clinician);
  expect(retry.status()).toBe(200); expect(await retry.json()).toMatchObject({ stage: "NOTES_CONFIRMED", draftRevision: winner.draftRevision });
  expect((await post(path, { action: "SAVE_NOTES", expectedRevision: first.draftRevision, data: notes }, clinician)).status()).toBe(409);
  expect((await post(path, { action: "SIGN", expectedRevision: first.draftRevision, data: { disposition: "OUTPATIENT" } }, clinician)).status()).toBe(409);
  const final = (await (await request.get(path, { headers: clinician })).json()).visit.encounters[0];
  expect(final.subjective).toBe(saved.subjective); expect(final.status).toBe("DRAFT");
});

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const encounterId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const updatedAt = "2026-10-15T10:00:00.000Z";
const savedEncounter = { id: encounterId, updatedAt, status: "DRAFT", clinician: { displayName: "Synthetic clinician" }, diagnoses: [], subjective: JSON.stringify({ chiefComplaint: "Saved complaint", historyPresentingIllness: "Latest saved history" }), objective: JSON.stringify({ generalExamination: "Recorded examination" }), plan: JSON.stringify({ disposition: "OUTPATIENT" }) };
function visit() { return { id, visitNumber: "V-RECOVERY", clinic: "Outpatient", priority: "ROUTINE", status: "AWAITING_CLINICIAN", arrivedAt: updatedAt, patient: { id, patientNumber: "P-RECOVERY", fullName: "Synthetic Recovery", estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", allergies: [] }, triage: { triageCategory: "ROUTINE", observations: [] }, encounters: [], orders: [] }; }
async function fixture(page: Page, permissions: string[] = [], items: object[] = []) {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Synthetic clinician", email: "test@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["visit.read", "encounter.write", "clinical.history.read", ...permissions], roles: ["CLINICIAN"], mustChangePassword: false } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [visit()] } }));
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  await page.route("**/api/catalog", route => route.fulfill({ json: { items } }));
  await page.route("**/api/patients/*/history?*", route => route.fulfill({ json: { visits: [], problems: [], timeline: [] } }));
  await page.route("**/api/visits/*/vitals", route => route.fulfill({ json: { measurements: [], truncated: false } }));
  await page.goto("/"); await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic Recovery.*P-RECOVERY/ }).click();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Examination", exact: true }).click();
  await page.getByRole("button", { name: "Save clinical notes", exact: true }).click();
}

test("conflict review preserves typed notes, clears failed reads and requires explicit replacement", async ({ page }, testInfo) => {
  let failRead = false; const posts: any[] = [];
  await page.route("**/api/visits/*/consultation", route => {
    if (route.request().method() === "POST") { posts.push(route.request().postDataJSON()); return route.fulfill({ status: 409, json: { error: "The saved consultation has changed. Your text is still here.", details: { code: "CONSULTATION_REVISION_CONFLICT" } } }); }
    return route.fulfill(failRead ? { status: 503, json: { error: "Synthetic recovery outage" } } : { json: { visit: { ...visit(), encounters: [savedEncounter] } } });
  });
  await fixture(page);
  await page.locator('[name="historyPresentingIllness"]').fill("Keep my unsaved history"); await save(page);
  const recovery = page.getByRole("region", { name: "Saved consultation recovery" });
  await recovery.getByRole("button", { name: "Review latest saved notes" }).focus(); await page.keyboard.press("Enter");
  await expect(recovery).toContainText("Latest saved history");
  await expect(page.locator('[name="historyPresentingIllness"]')).toHaveValue("Keep my unsaved history");
  for (const [index, width] of [1440, 768, 390, 320, 320, 320].entries()) {
    await page.setViewportSize({ width, height: 900 });
    if (index === 4) await page.evaluate(() => { document.body.style.fontFamily = "Arial, sans-serif"; document.body.style.fontSize = "17px"; });
    if (index === 5) await page.evaluate(() => { document.body.style.fontFamily = "monospace"; document.body.style.fontSize = "17px"; });
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width, text: el.textContent?.slice(0, 90) })));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: `${width}px, font variant ${index}: ${JSON.stringify(overflow)}` }).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`consultation-recovery-${width}.png`), fullPage: true, animations: "disabled" });
    await recovery.screenshot({ path: testInfo.outputPath(`consultation-recovery-panel-${width}.png`), animations: "disabled" });
  }
  await page.emulateMedia({ media: "print" }); await expect(recovery).toBeHidden(); await page.emulateMedia({ media: "screen" });
  failRead = true; await recovery.getByRole("button", { name: "Review latest saved notes" }).click();
  await expect(recovery).toContainText("Synthetic recovery outage"); await expect(recovery).not.toContainText("Latest saved history");
  failRead = false; await recovery.getByRole("button", { name: "Review latest saved notes" }).click();
  page.once("dialog", dialog => dialog.dismiss());
  await recovery.getByRole("button", { name: "Replace my form with this saved version" }).click();
  await expect(page.locator('[name="historyPresentingIllness"]')).toHaveValue("Keep my unsaved history");
  page.once("dialog", dialog => dialog.accept());
  await recovery.getByRole("button", { name: "Replace my form with this saved version" }).click();
  await expect(page.locator('[name="historyPresentingIllness"]')).toHaveValue("Latest saved history");
  await save(page); expect(posts[1].expectedRevision).toBe(`${encounterId}:${updatedAt}`);
});

test("signing saves the visible plan first and a delayed response cannot undo navigation", async ({ page }) => {
  const posts: any[] = []; let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  let worklistReads = 0;
  page.on("request", request => { if (request.method() === "GET" && request.url().endsWith("/api/visits")) worklistReads++; });
  await page.route("**/api/visits/*/consultation", async route => {
    const input = route.request().postDataJSON(); posts.push(input);
    if (input.action === "SAVE_NOTES") return route.fulfill({ json: { stage: "NOTES_SAVED", draftRevision: `${encounterId}:${updatedAt}` } });
    await pending; return route.fulfill({ json: { stage: "SIGNED", target: "AWAITING_PAYMENT" } });
  });
  await fixture(page);
  await page.getByRole("button", { name: "Plan & finish", exact: true }).click();
  await page.locator('[name="plan"]').fill("Visible plan must be saved before signing");
  await page.getByRole("button", { name: "Sign & send to next service" }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[0]).toMatchObject({ action: "SAVE_NOTES", expectedRevision: null, data: { plan: "Visible plan must be saved before signing" } });
  expect(posts[1]).toMatchObject({ action: "SIGN", expectedRevision: `${encounterId}:${updatedAt}` });
  page.once("dialog", async dialog => { expect(dialog.message()).toContain("request is still in progress"); await dialog.accept(); });
  await page.getByRole("button", { name: "← Back to queue" }).click();
  const signedResponse = page.waitForResponse(response => response.url().endsWith("/consultation") && response.request().postDataJSON().action === "SIGN");
  release(); await (await signedResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole("button", { name: /Synthetic Recovery.*P-RECOVERY/ })).toBeVisible();
  await expect(page.getByText(/Consultation signed for Synthetic Recovery/)).toHaveCount(0);
  expect(worklistReads).toBe(1);
});

test("an ambiguous save retains its original revision on retry and prevents repeated pending saves", async ({ page }) => {
  const posts: any[] = []; let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/visits/*/consultation", async route => {
    posts.push(route.request().postDataJSON());
    if (posts.length === 1) { await pending; return route.abort("failed"); }
    return route.fulfill({ json: { stage: "NOTES_CONFIRMED", draftRevision: `${encounterId}:${updatedAt}` } });
  });
  await fixture(page); await page.locator('[name="historyPresentingIllness"]').fill("Retain this text after connection loss"); await save(page);
  await expect(page.getByRole("button", { name: "Save clinical notes", exact: true })).toBeDisabled();
  expect(posts).toHaveLength(1); release();
  await expect(page.getByText("Could not reach the server. Check your connection and try again.", { exact: true })).toBeVisible();
  await expect(page.locator('[name="historyPresentingIllness"]')).toHaveValue("Retain this text after connection loss");
  await page.getByRole("button", { name: "Save clinical notes", exact: true }).click();
  await expect(page.getByText("Clinical notes saved as a draft.", { exact: true })).toBeVisible();
  expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
});

test("unsaved consultation guards queue, sidebar, room actions, patient switch, handoff and sign-out", async ({ page }, testInfo) => {
  let logoutRequests = 0;
  await page.route("**/api/auth/logout", route => { logoutRequests++; return route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/patients?q=*", route => route.fulfill({ json: { patients: [visit().patient] } }));
  await fixture(page, ["patient.read", "patient.create", "visit.create", "vitals.write", "billing.read"]);
  await expect(page.getByLabel("Unsaved consultation changes")).toHaveCount(0);
  await page.getByRole("button", { name: "← Back to queue" }).click();
  await page.getByRole("button", { name: /Synthetic Recovery.*P-RECOVERY/ }).click();
  await page.locator('[name="historyPresentingIllness"]').fill("Unsaved synthetic history");
  await expect(page.getByLabel("Unsaved consultation changes")).toContainText("clinical notes and plan");
  const cancelLeave = async (label: string) => {
    let warned = false;
    page.once("dialog", async dialog => { warned = true; expect(dialog.message()).toContain("Unsaved clinical notes"); await dialog.dismiss(); });
    await page.getByRole("button", { name: label, exact: true }).click();
    expect(warned).toBe(true);
    await expect(page.locator('[name="historyPresentingIllness"]')).toHaveValue("Unsaved synthetic history");
  };
  for (const label of ["← Back to queue", "Home", "Start visit from consultation", "Register new patient", "Take vitals", "Open billing", "Sign out"]) await cancelLeave(label);
  expect(logoutRequests).toBe(0);
  await page.getByPlaceholder("Name, patient number, phone, National ID or SHA number").fill("Synthetic");
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator(".globalPatientResults button").click();
  await expect(page.locator('[name="historyPresentingIllness"]')).toHaveValue("Unsaved synthetic history");
  await page.getByRole("button", { name: "Plan & finish", exact: true }).click();
  await cancelLeave("Open service points");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByLabel("Unsaved consultation changes").screenshot({ path: testInfo.outputPath("unsaved-consultation-mobile.png") });
  await page.emulateMedia({ media: "print" }); await expect(page.getByLabel("Unsaved consultation changes")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "← Back to queue" }).click();
  await expect(page.getByRole("button", { name: /Synthetic Recovery.*P-RECOVERY/ })).toBeVisible();
  // Discard is in-memory only; re-opening does not restore discarded notes.
  await page.getByRole("button", { name: /Synthetic Recovery.*P-RECOVERY/ }).click();
  await expect(page.locator('[name="historyPresentingIllness"]')).toHaveValue("");
});

test("reload warns, failed saves retain changes and edits during a save remain unsaved", async ({ page }) => {
  let posts = 0; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/visits/*/consultation", async route => {
    posts++;
    if (posts === 1) return route.fulfill({ status: 503, json: { error: "Synthetic save outage" } });
    if (posts === 2) await pending;
    return route.fulfill({ json: { stage: "NOTES_SAVED", draftRevision: `${encounterId}:${updatedAt}` } });
  });
  await fixture(page);
  const history = page.locator('[name="historyPresentingIllness"]');
  await history.fill("First synthetic draft");
  let reloadWarnings = 0;
  page.once("dialog", async dialog => { expect(dialog.type()).toBe("beforeunload"); reloadWarnings++; await dialog.dismiss(); });
  await page.evaluate(() => location.reload());
  await expect.poll(() => reloadWarnings).toBe(1);
  await expect(history).toHaveValue("First synthetic draft");
  await save(page); await expect(page.getByText("Synthetic save outage", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Unsaved consultation changes")).toContainText("clinical notes");
  await save(page); await expect.poll(() => posts).toBe(2);
  await page.getByRole("button", { name: "Presenting complaint & history" }).click();
  await history.fill("Newer edit while saving");
  release(); await expect(page.getByText("Clinical notes saved as a draft.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Unsaved consultation changes")).toContainText("clinical notes");
  await expect(history).toHaveValue("Newer edit while saving");
  await save(page); await expect.poll(() => posts).toBe(3);
  await expect(page.getByLabel("Unsaved consultation changes")).toHaveCount(0);
  const prevented = await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  expect(prevented).toBe(false);
  await page.getByRole("button", { name: "← Back to queue" }).click();
  await expect(page.getByRole("button", { name: /Synthetic Recovery.*P-RECOVERY/ })).toBeVisible();
});

test("notes do not clear diagnosis, investigation or prescription drafts and signing requires their review", async ({ page }) => {
  const posts: any[] = [];
  await page.route("**/api/visits/*/consultation", route => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({ json: { stage: "SAVED", orders: [], draftRevision: `${encounterId}:${updatedAt}` } });
  });
  await page.route("**/api/visits/*/investigations", route => route.fulfill({ json: { visit: { ...visit(), clinicallyClosedAt: null }, truncated: false, limit: 100 } }));
  await page.route("**/api/diagnoses/search?*", route => route.fulfill({ json: { results: [] } }));
  await fixture(page, [], [
    { code: "SYNTH-LAB", name: "Synthetic laboratory test", category: "LABORATORY_TEST", unitPrice: 100, active: true },
    { code: "SYNTH-MED", name: "Synthetic medicine", genericName: "Synthetic medicine", category: "PHARMACEUTICAL", unitPrice: 100, active: true, prescribingDefaults: { route: "Oral", frequencyPerDay: 1, durationDays: 2, doseUnit: "tablet", doseUnitsPerIssueUnit: 1, wholeIssueUnits: false } },
  ]);
  await page.getByRole("button", { name: "Diagnosis", exact: true }).click();
  await page.locator('[name="primaryDiagnosis"]').fill("Synthetic diagnosis selection");
  await page.getByRole("button", { name: "Investigations", exact: true }).first().click();
  await page.getByPlaceholder("Search laboratory tests…").fill("Synthetic");
  await page.getByRole("button", { name: /Synthetic laboratory test/ }).click();
  await page.getByRole("button", { name: "Medicines", exact: true }).click();
  await page.getByPlaceholder("Search medicine by generic, brand or strength…").fill("Synthetic");
  await page.getByRole("button", { name: /Synthetic medicine/ }).click();
  await save(page);
  const status = page.getByLabel("Unsaved consultation changes");
  await expect(status).toContainText("diagnosis, investigation requests, prescription");
  await expect(status).not.toContainText("clinical notes and plan");
  await page.getByRole("button", { name: "Plan & finish", exact: true }).click();
  await page.getByRole("button", { name: "Sign & send to next service" }).click();
  await expect(page.getByText(/Save or clear the unfinished diagnosis/)).toBeVisible();
  expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: "Investigations", exact: true }).first().click();
  await page.getByRole("button", { name: "Submit investigation requests" }).click();
  await expect(status).not.toContainText("investigation requests");
  await expect(status).toContainText("prescription");
  await page.getByRole("button", { name: "Medicines", exact: true }).click();
  await page.locator('[name="dose"]').fill("1 tablet");
  await page.locator('[name="route"]').selectOption("Oral");
  await page.locator('[name="frequencyPerDay"]').selectOption("1");
  await page.locator('[name="durationDays"]').fill("2");
  await expect(page.locator('[name="quantity"]')).toHaveValue("2");
  await page.locator('[name="quantityConfirmed"]').check();
  await page.getByRole("button", { name: "Save for later", exact: true }).click();
  await expect(status).toContainText("diagnosis");
  await expect(status).not.toContainText("prescription");
  await page.getByRole("button", { name: "Diagnosis", exact: true }).click();
  await page.locator('[name="primaryDiagnosis"]').fill("");
  await expect(status).toHaveCount(0);
  expect(posts.map(post => post.action)).toEqual(["SAVE_NOTES", "SUBMIT_INVESTIGATIONS", "SAVE_PRESCRIPTION"]);
});

test("a diagnosis response preserves a newer selection and a successful sign returns to the queue", async ({ page }) => {
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  const posts: any[] = [];
  await page.route("**/api/diagnoses/search?*", route => route.fulfill({ json: { results: [{ code: "SYNTH", title: "Synthetic diagnosis", source: "TEST", selectionToken: "synthetic-selection" }] } }));
  await page.route("**/api/visits/*/consultation", async route => {
    const post = route.request().postDataJSON(); posts.push(post);
    if (post.action === "SAVE_DIAGNOSIS") { await pending; return route.fulfill({ json: { diagnosis: { id, code: "SYNTH", description: "Synthetic diagnosis", primary: true }, draftRevision: `${encounterId}:${updatedAt}` } }); }
    return route.fulfill({ json: { stage: "SAVED", draftRevision: `${encounterId}:${updatedAt}` } });
  });
  await fixture(page);
  await page.getByRole("button", { name: "Diagnosis", exact: true }).click();
  const search = page.locator('[name="primaryDiagnosis"]');
  await search.fill("Synthetic"); await page.getByRole("button", { name: /Synthetic diagnosis.*SYNTH/ }).click();
  await page.getByRole("button", { name: "Add ICD-11 diagnosis" }).click();
  await expect.poll(() => posts.length).toBe(1);
  await search.fill("Newer diagnosis"); release();
  await expect(page.getByText("Primary ICD-11 diagnosis recorded.", { exact: true })).toBeVisible();
  await expect(search).toHaveValue("Newer diagnosis");
  await expect(page.getByLabel("Unsaved consultation changes")).toContainText("diagnosis");
  await page.getByRole("button", { name: "Diagnosis", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic diagnosis.*SYNTH/ }).click();
  await page.getByRole("button", { name: "Add ICD-11 diagnosis" }).click();
  await expect.poll(() => posts.length).toBe(2);
  await expect(page.getByLabel("Unsaved consultation changes")).toHaveCount(0);
  await page.getByRole("button", { name: "Plan & finish", exact: true }).click();
  await page.locator('[name="plan"]').fill("Synthetic plan");
  await page.getByRole("button", { name: "Sign & send to next service" }).click();
  await expect(page.getByRole("button", { name: /Synthetic Recovery.*P-RECOVERY/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign & send to next service" })).toHaveCount(0);
});

test("signing stops if notes change during its save and active-problem drafts stay protected", async ({ page }) => {
  const posts: any[] = []; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/visits/*/consultation", async route => {
    posts.push(route.request().postDataJSON()); await pending;
    return route.fulfill({ json: { stage: "NOTES_SAVED", draftRevision: `${encounterId}:${updatedAt}` } });
  });
  await fixture(page);
  await page.getByRole("button", { name: "Plan & finish", exact: true }).click();
  await page.locator('[name="plan"]').fill("First plan");
  await page.getByRole("button", { name: "Sign & send to next service" }).click();
  await expect.poll(() => posts.length).toBe(1);
  await page.locator('[name="plan"]').fill("Revised plan while saving");
  release(); await expect(page.getByText(/The form changed while notes were saving/)).toBeVisible();
  expect(posts[0].action).toBe("SAVE_NOTES"); expect(posts).toHaveLength(1);
  await expect(page.getByLabel("Unsaved consultation changes")).toContainText("clinical notes");
  await page.getByPlaceholder("Condition or persistent clinical concern").fill("Synthetic active problem");
  await expect(page.getByLabel("Unsaved consultation changes")).toContainText("active problem");
  await save(page); await expect.poll(() => posts.length).toBe(2);
  await expect(page.getByLabel("Unsaved consultation changes")).not.toContainText("clinical notes");
  await expect(page.getByLabel("Unsaved consultation changes")).toContainText("active problem");
  await page.getByPlaceholder("Condition or persistent clinical concern").fill("");
  await expect(page.getByLabel("Unsaved consultation changes")).toHaveCount(0);
});

test("failed sign-out preserves the form and confirmed sign-out does not ask twice", async ({ page }) => {
  let attempts = 0; let dialogs = 0;
  await page.route("**/api/auth/logout", async route => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: "Synthetic logout outage" } });
    await page.route("**/api/auth/me", request => request.fulfill({ status: 401, json: { error: "Signed out" } }));
    return route.fulfill({ json: { ok: true } });
  });
  await fixture(page);
  await page.locator('[name="historyPresentingIllness"]').fill("Retain this if logout fails");
  page.on("dialog", async dialog => { dialogs++; expect(dialog.type()).toBe("confirm"); await dialog.accept(); });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Sign out could not be confirmed" })).toBeVisible();
  await expect(page.locator('[name="historyPresentingIllness"]')).toHaveValue("Retain this if logout fails");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in securely" })).toBeVisible();
  expect(attempts).toBe(2); expect(dialogs).toBe(2);
});
