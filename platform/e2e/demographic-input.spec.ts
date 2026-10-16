import { expect, test, type APIRequestContext, type Dialog, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const password = "Mwein-E2E-Password-2026!";
async function apiLogin(request: APIRequestContext, email = "admin@mwein.local", facilityCode = "MMS") {
  const origin = `http://127.0.0.1:${process.env.E2E_APP_PORT || "3210"}`;
  const response = await request.post("/api/auth/login", { headers: { origin }, data: { facilityCode, email, password } });
  expect(response.status()).toBe(200);
  return { origin, cookie: response.headers()["set-cookie"].split(";")[0] };
}

async function openCorrection(page: Page) {
  const patient = { id: randomUUID(), fullName: "Synthetic demographic review", patientNumber: "MMS-SYNTHETIC-AGE" };
  const requestId = randomUUID();
  const record = { patient, consents: [], requests: [{
    id: requestId, type: "CORRECTION", status: "IN_REVIEW", details: "Synthetic age correction awaiting review",
    requestedAt: "2026-01-01T09:00:00.000Z", dueAt: "2026-01-15T09:00:00.000Z",
    completedAt: null, resolution: null, denialReason: null, evidenceReference: null,
    responsePreparedAt: null, responseEvidenceReference: null, deliveryEvidence: null,
    createdBy: { displayName: "Synthetic privacy officer" }, updatedBy: { displayName: "Synthetic privacy officer" },
    identityVerification: { requesterKind: "PATIENT", requesterReference: "SYNTHETIC-AGE-IDENTITY", verifiedByName: "Synthetic privacy officer", verifiedAt: "2026-01-01T10:00:00.000Z", identityEvidenceReference: "SYNTHETIC-IDENTITY-CHECK", authorizationScope: "REQUEST_REVIEW_ONLY", scopeSummary: "Reviewed identity for demographic correction" },
  }] };
  const mutations: Record<string, unknown>[] = [];
  // This test verifies the browser boundary and exact payload, not server persistence.
  await page.route("**/api/patients?q=*", route => route.fulfill({ json: { patients: [patient] } }));
  await page.route(`**/api/patients/${patient.id}/privacy`, route => {
    if (route.request().method() === "POST") {
      mutations.push(route.request().postDataJSON());
      return route.fulfill({ json: { record: record.requests[0] } });
    }
    return route.fulfill({ json: record });
  });
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email").fill("privacy@example.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Administration", exact: true }).click();
  await page.getByRole("button", { name: "Privacy & rights", exact: true }).click();
  await page.getByLabel("Find patient", { exact: true }).fill("Synthetic");
  await page.getByRole("button", { name: /Synthetic demographic review/ }).click();
  const button = page.getByRole("button", { name: "Apply correction", exact: true });
  await expect(button).toBeEnabled();
  return { button, mutations, requestId };
}

test("privacy correction rejects unrecorded ages before requesting a reason or sending a mutation", async ({ page }, testInfo) => {
  const { button, mutations } = await openCorrection(page);
  for (const raw of ["", "   ", "not an age", "NaN", "Infinity", "-1", "1.5", "131"]) {
    const prompts: string[] = [];
    const handler = async (dialog: Dialog) => {
      prompts.push(dialog.message());
      if (prompts.length === 1) await dialog.accept("estimatedAgeYears");
      else if (prompts.length === 2) await dialog.accept(raw);
      else await dialog.dismiss(); // A reason prompt here is a regression, even without a POST.
    };
    page.on("dialog", handler);
    await button.click();
    await expect(page.locator(".privacyRightsWorkspace .alert").first()).toContainText(/age/i);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Field to correct");
    expect(prompts[1]).toContain("Corrected value");
    expect(mutations).toHaveLength(0);
    page.off("dialog", handler);
  }
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(button).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440 || width === 320) await page.screenshot({ path: testInfo.outputPath(`demographic-age-error-${width}.png`), fullPage: true });
  }
});

test("reviewed age corrections retain distinct zero and clearing outcomes with attributable audit evidence", async ({ request }) => {
  test.setTimeout(90_000);
  const admin = await apiLogin(request);
  const dpo = await apiLogin(request, "privacy@example.test");
  const foreign = await apiLogin(request, "privacy@example.test", "OTHER");
  const reception = await apiLogin(request, "reception@example.test");
  async function get(path: string, headers = admin) {
    const response = await request.get(path, { headers }); expect(response.status()).toBe(200); return response.json();
  }
  async function post(path: string, data: object, headers = dpo) {
    const response = await request.post(path, { headers, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  }
  const actor = (await get("/api/auth/me", dpo)).user;
  const foreignActor = (await get("/api/auth/me", foreign)).user;
  expect(actor.permissions).toContain("privacy.manage"); expect(actor.sessionId).toBeTruthy();
  expect(foreignActor.permissions).toContain("privacy.manage"); expect(foreignActor.facilityId).not.toBe(actor.facilityId);
  expect((await get("/api/auth/me", reception)).user.permissions).not.toContain("privacy.manage");
  const suffix = randomUUID().slice(0, 8);
  const { patient } = await post("/api/patients", { givenName: "CorrectionBoundary", familyName: `Synthetic-${suffix}`, dateOfBirth: "1990-01-01", phone: "+254700000009", sexAtBirth: "UNKNOWN", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true }, admin);
  const path = `/api/patients/${patient.id}/privacy`;
  async function readDemographics() {
    const found = (await get(`/api/patients?q=${encodeURIComponent(patient.fullName)}`)).patients.filter((row: { id: string }) => row.id === patient.id);
    expect(found).toHaveLength(1);
    return { dateOfBirth: found[0].dateOfBirth, estimatedAgeYears: found[0].estimatedAgeYears };
  }
  async function startReviewedRequest(label: string) {
    const created = await post(path, { action: "CREATE_REQUEST", type: "CORRECTION", details: `Synthetic reviewed age correction ${label} ${suffix}` });
    const requestId = created.record.id;
    await post(path, { action: "VERIFY_IDENTITY", requestId, requestKey: randomUUID(), requesterKind: "PATIENT", requesterReference: `SYNTHETIC-AGE-${suffix}`, identityEvidenceReference: `SYNTHETIC-CHECK-${suffix}`, authorizationScope: "REQUEST_REVIEW_ONLY", scopeSummary: "Synthetic identity check for reviewed demographic age correction", attested: true });
    await post(path, { action: "UPDATE_REQUEST", requestId, status: "IN_REVIEW" });
    return requestId;
  }
  async function readRequest(requestId: string) {
    const row = (await get(path, dpo)).requests.find((item: { id: string }) => item.id === requestId);
    expect(row).toBeTruthy(); return row;
  }
  const zeroRequest = await startReviewedRequest("explicit zero");
  const baseline = await readDemographics(); expect(baseline).toEqual({ dateOfBirth: patient.dateOfBirth, estimatedAgeYears: null });
  const zeroReason = `Synthetic verified zero age ${suffix}`;
  const correction = { action: "APPLY_DEMOGRAPHIC_CORRECTION", requestId: zeroRequest, reason: zeroReason, changes: { estimatedAgeYears: 0 } };
  for (const value of ["", "  ", "abc", "0", false, true, [], [0], {}, -1, 1.5, 131]) {
    const response = await request.post(path, { headers: dpo, data: { ...correction, changes: { estimatedAgeYears: value } } });
    expect(response.status(), `Rejected raw age: ${JSON.stringify(value)}`).toBe(422);
  }
  expect((await request.post(path, { headers: foreign, data: correction })).status()).toBe(404);
  expect((await request.post(path, { headers: reception, data: correction })).status()).toBe(403);
  expect(await readDemographics()).toEqual(baseline);
  expect(await readRequest(zeroRequest)).toMatchObject({ status: "IN_REVIEW", completedAt: null, evidenceReference: null });
  const initialAudit = await get("/api/admin/audit/export"); expect(initialAudit.chain.valid).toBe(true);
  expect(initialAudit.events.filter((event: { action: string; entityId: string }) => event.action === "PATIENT_DEMOGRAPHICS_CORRECTED" && event.entityId === patient.id)).toEqual([]);

  await post(path, correction);
  expect(await readDemographics()).toEqual({ dateOfBirth: null, estimatedAgeYears: 0 });
  const zeroSaved = await readRequest(zeroRequest);
  expect(zeroSaved.status).toBe("COMPLETED"); expect(zeroSaved.completedAt).toBeTruthy();
  const clearRequest = await startReviewedRequest("explicit clear");
  const clearReason = `Synthetic verified age clearing ${suffix}`;
  await post(path, { action: "APPLY_DEMOGRAPHIC_CORRECTION", requestId: clearRequest, reason: clearReason, changes: { estimatedAgeYears: null } });
  expect(await readDemographics()).toEqual({ dateOfBirth: null, estimatedAgeYears: null });
  const clearSaved = await readRequest(clearRequest);
  expect(clearSaved.status).toBe("COMPLETED"); expect(clearSaved.completedAt).toBeTruthy();
  const audit = await get("/api/admin/audit/export"); expect(audit.chain.valid).toBe(true);
  const events = audit.events.filter((event: { action: string; entityId: string }) => event.action === "PATIENT_DEMOGRAPHICS_CORRECTED" && event.entityId === patient.id);
  expect(events).toHaveLength(2);
  for (const [saved, reason] of [[zeroSaved, zeroReason], [clearSaved, clearReason]] as const) {
    const event = events.find((item: { reason: string }) => item.reason === reason);
    expect(event).toMatchObject({ userId: actor.id, facilityId: actor.facilityId, sessionId: actor.sessionId, entityId: patient.id });
    expect(event.beforeHash).toMatch(/^[a-f0-9]{64}$/); expect(event.afterHash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.beforeHash).not.toBe(event.afterHash); expect(saved.evidenceReference).toBe(`audit:${event.id}`);
    expect(saved.identityVerification).toMatchObject({ patientId: patient.id, facilityId: actor.facilityId, verifiedById: actor.id, requestType: "CORRECTION" });
  }
});

test("privacy correction distinguishes explicit zero, explicit clearing and cancelling each prompt", async ({ page }) => {
  const { button, mutations, requestId } = await openCorrection(page);
  async function answerPrompts(answers: (string | null)[]) {
    const prompts: string[] = [];
    const handler = async (dialog: Dialog) => {
      const answer = answers[prompts.length]; prompts.push(dialog.message());
      if (answer == null) await dialog.dismiss(); else await dialog.accept(answer);
    };
    page.on("dialog", handler); await button.click();
    await expect(button).toBeEnabled();
    page.off("dialog", handler);
    expect(prompts).toHaveLength(answers.length);
    return prompts;
  }
  for (const answers of [[null], ["estimatedAgeYears", null], ["estimatedAgeYears", "0", null], ["estimatedAgeYears", "0", ""]] as (string | null)[][]) {
    await answerPrompts(answers); expect(mutations).toHaveLength(0);
  }
  for (const [raw, expected] of [["0", 0], ["NULL", null]] as const) {
    const before = mutations.length;
    const prompts = await answerPrompts(["estimatedAgeYears", raw, "Synthetic reviewed age correction"]);
    expect(prompts[2]).toContain("Correction reason");
    await expect.poll(() => mutations.length).toBe(before + 1);
    expect(mutations[before]).toEqual({ action: "APPLY_DEMOGRAPHIC_CORRECTION", requestId, reason: "Synthetic reviewed age correction", changes: { estimatedAgeYears: expected } });
    await expect(page.getByText("Verified demographic correction applied and request completed.", { exact: true })).toBeVisible();
  }
});

test("registration rejects invalid age types without patients, registration events or consumed patient numbers", async ({ request }) => {
  test.setTimeout(90_000);
  const headers = await apiLogin(request);
  const suffix = randomUUID().slice(0, 8);
  const base = { givenName: "AgeBoundary", familyName: `Synthetic-${suffix}`, phone: "+254700000009", sexAtBirth: "UNKNOWN", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true };
  async function register(data: object) {
    const response = await request.post("/api/patients", { headers, data });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).patient;
  }
  async function registrationEvents() {
    const response = await request.get("/api/admin/audit/export", { headers });
    expect(response.status()).toBe(200);
    const audit = await response.json(); expect(audit.chain.valid).toBe(true);
    return audit.events.filter((event: { action: string }) => event.action === "PATIENT_REGISTERED").map((event: { id: string }) => event.id);
  }
  const before = await register({ ...base, givenName: "BeforeAgeBoundary", estimatedAgeYears: 30 });
  const beforeEvents = await registrationEvents();
  const modes = [
    { registrationMode: "STANDARD" },
    { registrationMode: "GUARDIAN_ASSISTED", representativeName: "Synthetic guardian", representativeRelationship: "Guardian" },
    { registrationMode: "EMERGENCY_UNKNOWN", lawfulBasis: "VITAL_INTERESTS", emergencyReason: "Synthetic unidentified emergency registration" },
  ];
  for (const mode of modes) {
    for (const estimatedAgeYears of ["", "  ", null, false, true, [], [30], {}, "not an age"]) {
      const response = await request.post("/api/patients", { headers, data: { ...base, ...mode, estimatedAgeYears } });
      expect(response.status(), `${mode.registrationMode}: ${JSON.stringify(estimatedAgeYears)}`).toBe(422);
    }
  }
  expect(await registrationEvents()).toEqual(beforeEvents);
  const search = await request.get(`/api/patients?q=${encodeURIComponent(`AgeBoundary Synthetic-${suffix}`)}`, { headers });
  expect(search.status()).toBe(200);
  expect((await search.json()).patients.filter((patient: { fullName: string }) => patient.fullName === `AgeBoundary Synthetic-${suffix}`)).toEqual([]);
  const after = await register({ ...base, givenName: "AfterAgeBoundary", estimatedAgeYears: "0" });
  expect(after.estimatedAgeYears).toBe(0);
  expect(BigInt(after.patientNumber.split("-").at(-1))).toBe(BigInt(before.patientNumber.split("-").at(-1)) + 1n);
  const birth = await register({ ...base, givenName: "BirthAgeBoundary", dateOfBirth: "2000-01-01" });
  expect(birth.estimatedAgeYears).toBeNull();
  expect(birth.dateOfBirth).toContain("2000-01-01");
  const emergency = await register({ registrationMode: "EMERGENCY_UNKNOWN", lawfulBasis: "VITAL_INTERESTS", emergencyReason: "Synthetic unidentified patient with age genuinely unknown" });
  expect(emergency.estimatedAgeYears).toBeNull(); expect(emergency.dateOfBirth).toBeNull();
});
