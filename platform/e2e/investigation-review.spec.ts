import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function authenticate(request: APIRequestContext, email: string, facilityCode = "MMS") {
  const origin = `http://127.0.0.1:${process.env.E2E_APP_PORT || "3210"}`;
  const response = await request.post("/api/auth/login", { headers: { origin }, data: { facilityCode, email, password: "Mwein-E2E-Password-2026!" } });
  expect(response.status()).toBe(200);
  return { origin, cookie: response.headers()["set-cookie"].split(";")[0] };
}

test("draft diagnostics stay in their workbenches until verification releases them to clinicians", async ({ request }) => {
  const admin = await authenticate(request, "admin@mwein.local");
  const clinician = await authenticate(request, "clinician@example.test");
  const laboratory = await authenticate(request, "laboratory@example.test");
  const imaging = await authenticate(request, "imaging@example.test");
  async function post(path: string, data: unknown, headers = admin) {
    const response = await request.post(path, { headers, data }); const body = await response.json();
    expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  }
  async function get(path: string, headers = clinician) {
    const response = await request.get(path, { headers }); expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store"); return response.json();
  }
  const { patient } = await post("/api/patients", { givenName: "Diagnostic", familyName: `Synthetic-${randomUUID().slice(0, 8)}`, phone: "+254700000004", estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true, messagingConsent: false });
  const { visit } = await post("/api/visits", { patientId: patient.id, clinic: "Outpatient", priority: "ROUTINE", visitType: "WALK_IN", idempotencyKey: randomUUID() });
  const notesSaved = await post(`/api/visits/${visit.id}/consultation`, { action: "SAVE_NOTES", expectedRevision: null, data: { chiefComplaint: "Synthetic investigation review", historyPresentingIllness: "Synthetic history only", generalExamination: "Synthetic examination only", disposition: "OUTPATIENT" } }, clinician);
  const diagnosisResponse = await request.get("/api/diagnoses/search?q=headache", { headers: clinician });
  expect(diagnosisResponse.status()).toBe(200);
  const diagnosis = (await diagnosisResponse.json()).results[0]; expect(diagnosis).toBeTruthy();
  await post(`/api/visits/${visit.id}/consultation`, { action: "SAVE_DIAGNOSIS", expectedRevision: notesSaved.draftRevision, data: { ...diagnosis, primary: true, type: "PROVISIONAL" } }, clinician);
  await post(`/api/visits/${visit.id}/consultation`, { action: "SUBMIT_INVESTIGATIONS", data: { labs: ["FBC"], imaging: ["XRAY_CHEST"], priority: "ROUTINE", indication: "Synthetic release-boundary test" } }, clinician);
  const requested = (await get(`/api/visits/${visit.id}/investigations`)).visit.orders;
  const labOrder = requested.find((order: any) => order.type === "LABORATORY");
  const imagingOrder = requested.find((order: any) => order.type === "IMAGING");
  await post(`/api/orders/${labOrder.id}/specimen`, { action: "COLLECT", collectedAt: new Date().toISOString() }, laboratory);
  await post(`/api/orders/${labOrder.id}/specimen`, { action: "RECEIVE", receivedAt: new Date().toISOString(), specimenCondition: "ACCEPTABLE" }, laboratory);
  const labData = { reportText: "Unreleased laboratory narrative", items: [{ analyte: "Synthetic analyte", value: "draft-lab-value", unit: "synthetic" }] };
  const imageData = { findings: "Unreleased imaging findings", conclusion: "Unreleased imaging conclusion", performedAt: new Date().toISOString() };
  await post(`/api/orders/${labOrder.id}/laboratory-result`, { action: "SAVE_DRAFT", ...labData }, laboratory);
  await post(`/api/orders/${imagingOrder.id}/imaging-result`, { action: "SAVE_DRAFT", ...imageData }, imaging);
  const reads = [`/api/patients/${patient.id}/history`, `/api/visit-summaries?visitId=${visit.id}`, `/api/visits/${visit.id}/investigations`, "/api/visits"];
  for (const path of reads) {
    const body = JSON.stringify(await get(path));
    expect(body, path).not.toContain("draft-lab-value"); expect(body, path).not.toContain("Unreleased imaging");
  }
  const labWorkbench = JSON.stringify(await get("/api/visits", laboratory));
  expect(labWorkbench).toContain("draft-lab-value"); expect(labWorkbench).not.toContain("Unreleased imaging");
  const imagingWorkbench = JSON.stringify(await get("/api/visits", imaging));
  expect(imagingWorkbench).toContain("Unreleased imaging findings"); expect(imagingWorkbench).not.toContain("draft-lab-value");
  const reception = await authenticate(request, "reception@example.test");
  expect((await request.get(`/api/visits/${visit.id}/investigations`, { headers: reception })).status()).toBe(403);
  await post(`/api/orders/${labOrder.id}/laboratory-result`, { action: "VERIFY", ...labData, items: [{ analyte: "Synthetic analyte", value: "released-lab-value", unit: "synthetic" }], reportText: "Released laboratory narrative" }, laboratory);
  await post(`/api/orders/${imagingOrder.id}/imaging-result`, { action: "VERIFY", ...imageData, conclusion: "Released imaging conclusion" }, imaging);
  for (const path of reads) {
    const body = JSON.stringify(await get(path)); expect(body, path).toContain("released-lab-value"); expect(body, path).toContain("Released imaging conclusion");
  }
  const released = (await get(`/api/visits/${visit.id}/investigations`)).visit.orders;
  expect(released.find((order: any) => order.laboratory)?.laboratory.result).toMatchObject({ status: "VERIFIED", verifiedAt: expect.any(String), verifiedBy: { displayName: "MMS laboratory" } });
  expect((await request.post(`/api/orders/${labOrder.id}/laboratory-result`, { headers: laboratory, data: { action: "SAVE_DRAFT", ...labData } })).status()).toBe(409);

  // Exercise real authorization and facility predicates, not mocked query arguments.
  const other = await authenticate(request, "shared.user@example.test", "OTHER");
  for (const path of reads.slice(0, 3)) {
    for (const [headers, status] of [[{ cookie: "" }, 401], [reception, 403]] as const) {
      const denied = await request.get(path, { headers });
      expect(denied.status(), path).toBe(status);
      expect(denied.headers()["cache-control"]).toBe("private, no-store");
      expect(await denied.text()).not.toContain(patient.fullName);
    }
    const foreign = await request.get(path, { headers: other });
    expect(foreign.status(), path).toBe(path.startsWith("/api/visit-summaries") ? 200 : 404);
    expect(foreign.headers()["cache-control"]).toBe("private, no-store");
    const body = await foreign.json();
    if (foreign.status() === 200) expect(body).toEqual({ summaries: [] });
    expect(JSON.stringify(body)).not.toContain("released-lab-value");
    expect(JSON.stringify(body)).not.toContain(patient.id);
  }
  const me = (await get("/api/auth/me")).user;
  const audit = await get("/api/admin/audit/export", admin);
  expect(audit.chain.valid).toBe(true);
  for (const [context, type, resourceId] of [
    ["PATIENT_HISTORY", "Patient", patient.id],
    ["VISIT_SUMMARIES", "Visit", visit.id],
    ["VISIT_INVESTIGATIONS", "Visit", visit.id],
  ]) {
    const disclosures = audit.events.filter((event: any) => {
      if (event.action !== "CLINICAL_RECORDS_ACCESSED") return false;
      const reason = JSON.parse(event.reason);
      return reason.context === context && reason.resources.some((resource: any) => resource.type === type && resource.id === resourceId);
    });
    expect(disclosures.length, context).toBeGreaterThanOrEqual(2);
    for (const event of disclosures) {
      expect(event).toMatchObject({ userId: me.id, facilityId: me.facilityId, sessionId: expect.any(String) });
      expect(event.reason).not.toContain("released-lab-value");
      expect(event.reason).not.toContain(patient.fullName);
    }
    if (context === "VISIT_INVESTIGATIONS") {
      const labId = released.find((order: any) => order.laboratory)?.laboratory.result.id;
      const imageId = released.find((order: any) => order.imaging)?.imaging.result.id;
      expect(disclosures.some((event: any) => {
        const resources = JSON.parse(event.reason).resources;
        return resources.some((resource: any) => resource.type === "LaboratoryResult" && resource.id === labId)
          && resources.some((resource: any) => resource.type === "ImagingResult" && resource.id === imageId);
      })).toBe(true);
    }
  }
});

const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = "2026-10-15T10:00:00Z";
function visit(id: string, name: string) {
  return { id, visitNumber: `V-${name}`, clinic: "Outpatient", priority: "ROUTINE", status: "AWAITING_CLINICIAN", arrivedAt: now, patient: { id, patientNumber: `P-${name}`, fullName: `Synthetic ${name}`, estimatedAgeYears: 30, sexAtBirth: "UNKNOWN", allergies: [] }, triage: { triageCategory: "ROUTINE", observations: [] }, encounters: [], orders: [] };
}
function reports() {
  const first = visit(firstId, "Results");
  const common = { status: "COMPLETED", priority: "ROUTINE", clinicalIndication: "Synthetic investigation", requestedAt: now };
  return { visit: { ...first, clinicallyClosedAt: null, orders: [
    { ...common, id: "lab", type: "LABORATORY", displayName: "Synthetic blood test", imaging: null, laboratory: { accessionNumber: "LAB-001", specimenType: "Blood", specimenStatus: "ACCEPTED", collectedAt: now, receivedAt: now, rejectionReason: null, result: { id: "result-lab", status: "VERIFIED", verifiedAt: now, verifiedBy: { displayName: "Synthetic laboratory verifier" }, criticalResult: true, criticalNotifiedTo: "Synthetic clinician", criticalNotifiedAt: now, criticalNotificationMethod: "PHONE", criticalReadBack: true, criticalConfirmation: "Read-back recorded in this synthetic fixture", criticalEscalation: null, reportText: "Synthetic report narrative", items: [{ id: "value", analyte: "Synthetic analyte", value: "42", unit: "test units", referenceRange: "Synthetic only", flag: "HH", critical: true }] } } },
    { ...common, id: "imaging", type: "IMAGING", displayName: "Synthetic imaging", laboratory: null, imaging: { modality: "X-RAY", result: { id: "result-image", status: "VERIFIED", verifiedAt: now, verifiedBy: { displayName: "Synthetic imaging verifier" }, performedAt: now, findings: "Synthetic imaging findings", conclusion: "Synthetic imaging conclusion", recommendations: "Synthetic recommendation", technique: "Synthetic technique" } } },
    { ...common, id: "pending", status: "IN_PROGRESS", type: "LABORATORY", displayName: "Synthetic pending test", imaging: null, laboratory: { specimenType: "Blood", specimenStatus: "REJECTED", accessionNumber: "LAB-002", collectedAt: now, receivedAt: now, rejectionReason: "Synthetic rejection reason", result: null } },
  ] }, truncated: false, limit: 200 };
}
async function fixture(page: Page) {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { displayName: "Synthetic clinician", email: "test@example.test", facility: { name: "Synthetic clinic", timezone: "Africa/Nairobi" }, permissions: ["visit.read", "encounter.write", "clinical.history.read", "clinical.results.read"], roles: ["CLINICIAN"], mustChangePassword: false } } }));
  await page.route("**/api/visits", route => route.fulfill({ json: { visits: [visit(firstId, "Results"), visit(secondId, "Other")] } }));
  await page.route("**/api/queues", route => route.fulfill({ json: { entries: [], controls: [], history: [] } }));
  await page.route("**/api/catalog", route => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/patients/*/history?*", route => route.fulfill({ json: { visits: [], problems: [], timeline: [] } }));
  await page.route("**/api/visits/*/vitals", route => route.fulfill({ json: { measurements: [], truncated: false } }));
  await page.goto("/"); await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic Results.*P-Results/ }).click();
}

test("results refresh preserves notes, clears failed data and supports keyboard and phone review", async ({ page }, testInfo) => {
  let fail = false; let posts = 0;
  page.on("request", request => { if (request.method() === "POST") posts++; });
  await page.route("**/api/visits/*/investigations", route => route.fulfill(fail ? { status: 503, json: { error: "Synthetic results outage" } } : { json: reports() }));
  await fixture(page);
  await page.locator('[name="historyPresentingIllness"]').fill("Unsaved consultation notes stay here");
  await page.getByRole("button", { name: "Investigations", exact: true }).click();
  const panel = page.getByRole("region", { name: "Investigation results", exact: true });
  await expect(panel).toContainText("Specimen rejected");
  await expect(page.getByRole("region", { name: "Clinical review overview" })).not.toContainText("pending order(s)");
  await panel.getByText("Read verified report · Synthetic blood test", { exact: true }).focus();
  await page.keyboard.press("Enter"); await expect(panel).toContainText("Critical result");
  await panel.getByText("Read verified report · Synthetic imaging", { exact: true }).click();
  await expect(panel.getByText("Synthetic imaging conclusion", { exact: false })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("investigation-review-desktop.png"), fullPage: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(panel.getByText("Synthetic laboratory verifier", { exact: false })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`investigation-review-${width}.png`), fullPage: true });
  }
  fail = true; await panel.getByRole("button", { name: "Refresh results" }).click();
  await expect(panel.getByRole("alert")).toContainText("Synthetic results outage");
  await expect(panel.getByText("Synthetic imaging conclusion", { exact: false })).toHaveCount(0);
  await expect(panel).not.toContainText("No investigations requested");
  await expect(page.locator('[name="historyPresentingIllness"]')).toHaveValue("Unsaved consultation notes stay here");
  fail = false; await panel.getByRole("button", { name: "Refresh results" }).click();
  await expect(panel).toContainText("Verified report available"); expect(posts).toBe(0);
});

test("a delayed result response cannot cross into another patient's consultation", async ({ page }) => {
  let release!: () => void, requested!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route("**/api/visits/*/investigations", async route => {
    if (route.request().url().includes(firstId)) { requested(); await pending; return route.fulfill({ json: reports() }); }
    return route.fulfill({ json: { visit: { ...visit(secondId, "Other"), clinicallyClosedAt: null }, truncated: false, limit: 200 } });
  });
  await fixture(page); await page.getByRole("button", { name: "Investigations", exact: true }).click(); await started;
  await expect(page.getByText("Loading investigations for this visit…")).toBeVisible();
  await page.getByRole("button", { name: "← Back to queue" }).click();
  await page.getByRole("button", { name: /Synthetic Other.*P-Other/ }).click();
  await page.getByRole("button", { name: "Investigations", exact: true }).click();
  const panel = page.getByRole("region", { name: "Investigation results", exact: true });
  await expect(panel).toContainText("No investigations requested"); release();
  await expect(panel).toContainText("Synthetic Other"); await expect(panel).not.toContainText("Synthetic Results"); await expect(panel).not.toContainText("Synthetic blood test");
});
