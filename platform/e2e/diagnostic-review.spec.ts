import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function authenticate(request: APIRequestContext, email: string, facilityCode = "MMS") {
  const origin = `http://127.0.0.1:${process.env.E2E_APP_PORT || "3210"}`;
  const response = await request.post("/api/auth/login", { headers: { origin }, data: { facilityCode, email, password: "Mwein-E2E-Password-2026!" } });
  expect(response.status()).toBe(200); return { origin, cookie: response.headers()["set-cookie"].split(";")[0] };
}

test("diagnostic ownership, handover and acknowledgement serialize and survive clinical closure", async ({ request }) => {
  test.setTimeout(60_000);
  const admin = await authenticate(request, "admin@mwein.local"), clinician = await authenticate(request, "clinician@example.test"), cover = await authenticate(request, "clinician.cover@example.test");
  const lab = await authenticate(request, "laboratory@example.test"), imaging = await authenticate(request, "imaging@example.test");
  const reception = await authenticate(request, "shared.user@example.test", "OTHER");
  const otherClinician = await authenticate(request, "diagnostic.other@example.test", "OTHER");
  async function post(path: string, data: unknown, headers = clinician) { const response = await request.post(path, { headers, data }); const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body; }
  async function get(path: string, headers = clinician) { const response = await request.get(path, { headers }); expect(response.status()).toBe(200); return response.json(); }
  const { patient } = await post("/api/patients", { givenName: "Review", familyName: `Synthetic-${randomUUID().slice(0, 8)}`, phone: "+254700000005", estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false }, admin);
  const { visit } = await post("/api/visits", { patientId: patient.id, clinic: "Outpatient", priority: "ROUTINE", visitType: "WALK_IN", idempotencyKey: randomUUID() }, admin);
  const notes = await post(`/api/visits/${visit.id}/consultation`, { action: "SAVE_NOTES", expectedRevision: null, data: { chiefComplaint: "Synthetic review", historyPresentingIllness: "Synthetic history", generalExamination: "Synthetic examination", plan: "Synthetic documented review plan", disposition: "OUTPATIENT" } });
  const diagnosis = (await get("/api/diagnoses/search?q=headache")).results[0];
  const diagnosed = await post(`/api/visits/${visit.id}/consultation`, { action: "SAVE_DIAGNOSIS", expectedRevision: notes.draftRevision, data: { ...diagnosis, primary: true, type: "PROVISIONAL" } });
  await post(`/api/visits/${visit.id}/consultation`, { action: "SUBMIT_INVESTIGATIONS", data: { labs: ["FBC"], imaging: ["XRAY_CHEST"], priority: "ROUTINE", indication: "Synthetic review ownership check" } });
  const orders = (await get(`/api/visits/${visit.id}/investigations`)).visit.orders;
  const laboratory = orders.find((o: any) => o.type === "LABORATORY"), image = orders.find((o: any) => o.type === "IMAGING");
  const path = `/api/orders/${laboratory.id}/diagnostic-review`;
  expect((await request.get(path, { headers: reception })).status()).toBe(403);
  expect((await request.post(path, { headers: lab, data: {} })).status()).toBe(403);
  const claim = { action: "CLAIM", expectedEventId: null, requestKey: randomUUID(), note: "Synthetic responsibility accepted" };
  expect((await request.get(path, { headers: otherClinician })).status()).toBe(404);
  expect((await request.post(path, { headers: otherClinician, data: claim })).status()).toBe(404);
  expect((await get("/api/diagnostic-reviews", otherClinician)).orders).toEqual([]);
  const concurrent = await Promise.all([request.post(path, { headers: clinician, data: claim }), request.post(path, { headers: clinician, data: claim })]);
  expect(concurrent.map(r => r.status()).sort()).toEqual([200, 201]);
  let saved = (await get(path)).order;
  expect(saved.diagnosticReviews).toHaveLength(1); const first = saved.diagnosticReviews[0];
  const invalidAck = { action: "ACKNOWLEDGE", expectedEventId: first.id, requestKey: randomUUID(), note: "Synthetic review", resultId: randomUUID(), verifiedAt: new Date().toISOString(), attested: true };
  expect((await request.post(path, { headers: clinician, data: invalidAck })).status()).toBe(409);
  const handover = await post(path, { action: "CLAIM", expectedEventId: first.id, requestKey: randomUUID(), note: "Synthetic covering clinician accepts responsibility" }, cover);
  expect((await request.post(path, { headers: clinician, data: { ...invalidAck, requestKey: randomUUID() } })).status()).toBe(409);
  // Different simultaneous requests cannot both take an unclaimed imaging task.
  const imagePath = `/api/orders/${image.id}/diagnostic-review`;
  const competing = await Promise.all([clinician, cover].map(headers => request.post(imagePath, { headers, data: { ...claim, requestKey: randomUUID() } })));
  expect(competing.map(r => r.status()).sort()).toEqual([201, 409]);
  await post(`/api/orders/${laboratory.id}/specimen`, { action: "COLLECT", collectedAt: new Date().toISOString() }, lab);
  await post(`/api/orders/${laboratory.id}/specimen`, { action: "RECEIVE", receivedAt: new Date().toISOString(), specimenCondition: "ACCEPTABLE" }, lab);
  await post(`/api/orders/${laboratory.id}/laboratory-result`, { action: "VERIFY", reportText: "Synthetic released review report", items: [{ analyte: "Synthetic analyte", value: "42", unit: "test units" }] }, lab);
  await post(`/api/orders/${image.id}/imaging-result`, { action: "VERIFY", findings: "Synthetic imaging findings", conclusion: "Synthetic imaging conclusion", performedAt: new Date().toISOString() }, imaging);
  await post(`/api/visits/${visit.id}/consultation`, { action: "SIGN", expectedRevision: diagnosed.draftRevision, data: { disposition: "OUTPATIENT" } });
  await post(`/api/visits/${visit.id}/discharge`, { outcome: "OUTPATIENT", details: "Synthetic closed visit with ongoing result review" });
  const outstanding = (await get("/api/diagnostic-reviews?state=RELEASED")).orders.find((o: any) => o.id === laboratory.id);
  expect(outstanding.visit.clinicallyClosedAt).toBeTruthy();
  saved = (await get(path)).order;
  const acknowledgement = { action: "ACKNOWLEDGE", expectedEventId: handover.eventId, requestKey: randomUUID(), note: "Synthetic report reviewed; follow-up plan retained", resultId: saved.laboratory.result.id, verifiedAt: saved.laboratory.result.verifiedAt, attested: true };
  expect((await request.post(path, { headers: clinician, data: acknowledgement })).status()).toBe(409);
  const acknowledgements = await Promise.all([request.post(path, { headers: cover, data: acknowledgement }), request.post(path, { headers: cover, data: { ...acknowledgement, requestKey: randomUUID() } })]);
  expect(acknowledgements.map(r => r.status()).sort()).toEqual([201, 409]);
  saved = (await get(path)).order;
  expect(saved.diagnosticReviews).toHaveLength(3); expect(saved.diagnosticReviews[0]).toMatchObject({ action: "ACKNOWLEDGE", actor: { displayName: "MMS clinician cover" } });
  expect(saved.visit.clinicallyClosedAt).toBe(outstanding.visit.clinicallyClosedAt);
  expect((await get("/api/diagnostic-reviews?state=RELEASED")).orders.some((o: any) => o.id === laboratory.id)).toBe(false);
  expect((await get("/api/diagnostic-reviews?state=ACKNOWLEDGED")).orders.some((o: any) => o.id === laboratory.id)).toBe(true);
});

const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", actorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = "2026-10-15T10:00:00.000Z";
function synthetic(id = orderId) { return { id, displayName: id === orderId ? "Synthetic blood test" : "Synthetic other test", type: "LABORATORY", status: "COMPLETED", priority: "ROUTINE", requestedAt: now, orderedBy: { displayName: "Synthetic requesting clinician" }, visit: { id, visitNumber: "V-SYNTHETIC", status: "DISCHARGED", clinicallyClosedAt: now, patient: { fullName: id === orderId ? "Synthetic Review Patient" : "Synthetic Other Patient", patientNumber: "P-SYNTHETIC" } }, diagnosticReviews: [] as any[], laboratory: { specimenStatus: "ACCEPTED", result: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", verifiedAt: now } }, imaging: null }; }
async function fixture(page: Page, readOnly = false) {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { id: actorId, displayName: "Synthetic clinician", email: "test@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["visit.read", "clinical.results.read", ...(!readOnly ? ["encounter.write"] : [])], roles: ["CLINICIAN"], mustChangePassword: false } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [] } }));
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  await page.route("**/api/visits/*/investigations", route => route.fulfill({ json: { visit: { ...synthetic().visit, orders: [{ ...synthetic(), laboratory: { specimenType: "Blood", specimenStatus: "ACCEPTED", collectedAt: now, receivedAt: now, result: { ...synthetic().laboratory.result, status: "VERIFIED", verifiedBy: { displayName: "Synthetic verifier" }, reportText: "Synthetic result narrative", criticalResult: false, items: [{ id: "value", analyte: "Synthetic analyte", value: "42", unit: null, referenceRange: null, flag: null }] } } }] }, truncated: false, limit: 200 } }));
  await page.goto("/"); await page.getByRole("button", { name: "Diagnostic review work", exact: true }).click();
}

test("review recovery preserves the exact action, confirms saved work and renders compact layouts", async ({ page }, testInfo) => {
  const order = synthetic(); let posts = 0, failDetail = false, failList = false; const bodies: unknown[] = [];
  await page.route("**/api/diagnostic-reviews?*", route => route.fulfill(failList ? { status: 503, json: { error: "Synthetic worklist outage" } } : { json: { orders: [order], limit: 100, truncated: false } }));
  await page.route("**/api/orders/*/diagnostic-review", async route => {
    if (route.request().method() === "GET") return route.fulfill(failDetail ? { status: 503, json: { error: "Synthetic saved-review outage" } } : { json: { order, actorId, canReview: true, historyTruncated: false } });
    const body = route.request().postDataJSON(); bodies.push(body); posts++;
    if (posts === 1) { order.diagnosticReviews = [{ id: randomUUID(), sequence: 1, action: "CLAIM", note: body.note, recordedAt: now, actor: { id: actorId, displayName: "Synthetic clinician" } }]; return route.abort("failed"); }
    if (posts === 2) { failDetail = true; return route.fulfill({ json: { eventId: order.diagnosticReviews[0].id, replayed: true } }); }
    order.diagnosticReviews.unshift({ id: randomUUID(), sequence: 2, action: "ACKNOWLEDGE", note: body.note, recordedAt: now, actor: { id: actorId, displayName: "Synthetic clinician" } });
    return route.fulfill({ status: 201, json: { eventId: order.diagnosticReviews[0].id, replayed: false } });
  });
  await fixture(page);
  await page.getByRole("button", { name: /Synthetic Review Patient.*Synthetic blood test/ }).click();
  const detail = page.getByRole("region", { name: "Selected diagnostic review" });
  await detail.getByLabel("Responsibility or handover reason").fill("Synthetic handover accepted with retained plan");
  await detail.getByRole("button", { name: "Accept review responsibility" }).click();
  await expect(detail.getByRole("alert")).toContainText("unconfirmed");
  await expect(detail.getByLabel("Responsibility or handover reason")).toBeDisabled();
  await detail.getByRole("button", { name: "Retry same review action" }).click();
  await expect(detail.getByRole("status").filter({ hasText: "confirmed as saved" })).toBeVisible();
  await expect(detail.getByRole("alert")).toContainText("Synthetic saved-review outage");
  expect(bodies[0]).toEqual(bodies[1]);
  failDetail = false; await detail.getByRole("button", { name: "Reload saved review" }).click();
  await expect(detail.getByRole("region", { name: "Diagnostic review history" })).toContainText("Synthetic handover accepted");
  await detail.getByLabel("Review findings and next steps").fill("Synthetic report reviewed; plan retained for follow-up");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(detail.getByLabel("Review findings and next steps")).toHaveValue("Synthetic report reviewed; plan retained for follow-up");
  await detail.getByText("Read verified report · Synthetic blood test", { exact: true }).click();
  await expect(detail).toContainText("Not supplied");
  await page.emulateMedia({ media: "print" });
  await expect(detail.getByLabel("Review findings and next steps")).toBeHidden();
  await expect(detail.getByRole("region", { name: "Diagnostic review history" })).toBeVisible();
  await expect(detail.getByText("Synthetic result narrative", { exact: true })).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    if ([1440, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`diagnostic-review-${width}.png`), fullPage: true });
  }
  for (const fontFamily of ["Arial, sans-serif", "monospace"]) {
    await page.addStyleTag({ content: `* { font-family: ${fontFamily} !important; } body { font-size: 17px !important; }` });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
  page.once("dialog", dialog => dialog.dismiss()); await detail.getByRole("button", { name: "Reload saved review" }).click();
  await expect(detail.getByLabel("Review findings and next steps")).toHaveValue("Synthetic report reviewed; plan retained for follow-up");
  await detail.getByLabel("I have read the verified report identified above and recorded my review and next steps.").check();
  await detail.getByRole("button", { name: "Acknowledge reviewed report" }).click();
  await expect(detail.getByRole("region", { name: "Diagnostic review history" })).toContainText("Report acknowledged");
  await page.emulateMedia({ media: "print" });
  await expect(detail.getByRole("button", { name: "Reload saved review" })).toBeHidden();
  await expect(detail.getByRole("region", { name: "Diagnostic review history" })).toBeVisible();
  await expect(detail.getByText("Synthetic report reviewed; plan retained for follow-up", { exact: true })).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  failList = true; await page.getByRole("button", { name: "Refresh worklist" }).click();
  await expect(page.getByText(/Worklist unavailable/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Synthetic Review Patient.*Synthetic blood test/ })).toHaveCount(0); expect(posts).toBe(3);
});

test("diagnostic navigation rejects stale reads and respects read-only access", async ({ page }) => {
  let release!: () => void; const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/diagnostic-reviews?*", route => route.fulfill({ json: { orders: [synthetic(), synthetic(otherId)], limit: 100, truncated: true } }));
  await page.route("**/api/orders/*/diagnostic-review", async route => {
    const id = route.request().url().includes(otherId) ? otherId : orderId;
    if (id === orderId) await delayed;
    return route.fulfill({ json: { order: synthetic(id), actorId, canReview: false, historyTruncated: false } });
  });
  await fixture(page, true);
  await expect(page.getByText(/more work remains/)).toBeVisible();
  await page.getByRole("button", { name: /Synthetic Review Patient.*Synthetic blood test/ }).click();
  await expect(page.getByText("Loading saved review…")).toBeVisible();
  await page.getByRole("button", { name: /Synthetic Other Patient.*Synthetic other test/ }).click();
  const detail = page.getByRole("region", { name: "Selected diagnostic review" });
  await expect(detail).toContainText("Synthetic other test"); release();
  await expect(detail.getByRole("heading", { level: 4 }).first()).toContainText("Synthetic Other Patient");
  await expect(detail).toContainText("Read-only access");
  await expect(detail.getByRole("button", { name: "Accept review responsibility" })).toHaveCount(0);
});
