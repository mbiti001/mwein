import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const password = "Mwein-E2E-Password-2026!";
async function login(page: Page, email = "reception@example.test", facilityCode = "MMS") {
  await page.goto("/");
  await page.getByLabel("Facility code").fill(facilityCode);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
}

async function registration(page: Page) {
  await page.getByRole("button", { name: "Registration", exact: true }).click();
  return page.getByRole("form", { name: "Patient registration" });
}

async function submit(page: Page, form: Locator) {
  const response = page.waitForResponse(result => new URL(result.url()).pathname === "/api/patients" && result.request().method() === "POST");
  await form.getByRole("button", { name: "Register patient and continue" }).click();
  return response;
}

// Browser fetch uses the real HttpOnly session cookie, including Secure localhost
// cookies. No auth, patient, validation or persistence responses are mocked here.
async function read<T>(page: Page, path: string): Promise<T> {
  const result = await page.evaluate(async url => {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  }, path);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body as T;
}

type Patient = { id: string; fullName: string; patientNumber: string; estimatedAgeYears: number | null; dateOfBirth: string | null; givenName: string | null; familyName: string | null; contacts: unknown[]; addresses: unknown[]; facilityId: string };
type Actor = { id: string; facilityId: string; permissions: string[] };

test("standard registration rejects blank age and durably saves a deliberately entered zero", async ({ page }) => {
  await login(page);
  const form = await registration(page);
  const suffix = randomUUID().slice(0, 8);
  await form.getByLabel("First name *").fill("BrowserZero");
  await form.getByLabel("Surname *").fill(`Synthetic-${suffix}`);
  await form.getByLabel("Sex at birth *").selectOption("UNKNOWN");
  await form.getByLabel("Phone *", { exact: true }).fill("+254700000012");
  await form.getByLabel("County *", { exact: true }).fill("Nairobi");
  await form.getByLabel("Subcounty *", { exact: true }).fill("Westlands");
  await form.getByLabel("Consent to treatment *").check();
  await form.getByLabel("Consent to electronic record *").check();
  const rejected = await submit(page, form);
  expect(rejected.status()).toBe(422);
  expect(rejected.request().postDataJSON()).not.toHaveProperty("estimatedAgeYears");
  await expect(form.getByRole("alert")).toContainText("Date of birth or estimated age is required");
  expect((await read<{ patients: Patient[] }>(page, `/api/patients?q=${encodeURIComponent(`BrowserZero Synthetic-${suffix}`)}`)).patients).toEqual([]);
  // The validation failure must retain the entered demographics for correction.
  await expect(form.getByLabel("First name *")).toHaveValue("BrowserZero");
  await expect(form.getByLabel("County *", { exact: true })).toHaveValue("Nairobi");
  await form.getByLabel("Estimated age", { exact: true }).fill("0");
  const saved = await submit(page, form);
  expect(saved.status(), await saved.text()).toBe(201);
  expect(saved.request().postDataJSON().estimatedAgeYears).toBe("0");
  const { patient } = await saved.json();
  await expect(page.getByRole("heading", { name: "Clinic check-in" })).toBeVisible();
  await expect(page.locator(".patientBanner")).toContainText("Child · 0 years");
  const reread = await read<{ patients: Patient[] }>(page, `/api/patients?q=${encodeURIComponent(patient.patientNumber)}`);
  expect(reread.patients).toHaveLength(1);
  expect(reread.patients[0]).toMatchObject({ id: patient.id, estimatedAgeYears: 0, dateOfBirth: null, addresses: [{ county: "Nairobi", subcounty: "Westlands" }] });
});

test("emergency registration saves genuinely missing identity and location with attributable consent evidence", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  await login(page);
  const actor = (await read<{ user: Actor }>(page, "/api/auth/me")).user;
  expect(actor.permissions).toContain("patient.create");
  const form = await registration(page);
  await form.getByLabel("Registration route").selectOption("EMERGENCY_UNKNOWN");
  // Soft assertions allow the baseline POST failure to be captured independently
  // of a fabricated default county. Do not clear fields on behalf of the UI.
  for (const name of ["givenName", "middleName", "familyName", "phone", "dateOfBirth", "estimatedAgeYears", "county", "subcounty", "ward", "village"]) {
    await expect.soft(form.locator(`[name="${name}"]`), `${name} starts unrecorded`).toHaveValue("");
  }
  const reason = `Synthetic unidentified emergency with identity unavailable ${randomUUID().slice(0, 8)}`;
  await expect(form.getByRole("combobox", { name: "Sex at birth", exact: true })).not.toHaveAttribute("required", "");
  await expect(form.locator('[name="sexAtBirth"]')).toHaveValue("");
  await form.getByLabel("Emergency registration reason *").fill(reason);
  const saved = await submit(page, form);
  await testInfo.attach("emergency-registration-response", { body: await saved.text(), contentType: "application/json" });
  expect(saved.status(), await saved.text()).toBe(201);
  const payload = saved.request().postDataJSON();
  for (const name of ["givenName", "familyName", "phone", "dateOfBirth", "estimatedAgeYears", "county", "subcounty", "sexAtBirth"]) expect(payload).not.toHaveProperty(name);
  expect(payload).toMatchObject({ registrationMode: "EMERGENCY_UNKNOWN", lawfulBasis: "VITAL_INTERESTS", treatmentConsent: false, electronicRecordConsent: false, messagingConsent: false });
  const { patient } = await saved.json();
  expect(patient).toMatchObject({ facilityId: actor.facilityId, estimatedAgeYears: null, dateOfBirth: null, givenName: null, familyName: null, sexAtBirth: "UNKNOWN", identityStatus: "UNIDENTIFIED", restricted: true, contacts: [], addresses: [] });
  expect(patient.fullName).toBe(`Unidentified patient ${patient.patientNumber}`);
  await expect(page.getByRole("heading", { name: "Clinic check-in" })).toBeVisible();
  await expect(page.locator(".patientBanner")).toContainText(patient.patientNumber);
  await expect(page.locator(".patientBanner")).toContainText("age unknown");
  const reread = await read<{ patients: Patient[] }>(page, `/api/patients?q=${encodeURIComponent(patient.patientNumber)}`);
  expect(reread.patients).toHaveLength(1);
  expect(reread.patients[0]).toMatchObject({ id: patient.id, estimatedAgeYears: null, dateOfBirth: null, givenName: null, familyName: null, sexAtBirth: "UNKNOWN", contacts: [], addresses: [] });

  const reviewContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const review = await reviewContext.newPage();
    await login(review, "admin@mwein.local");
    const privacy = await read<{ consents: { type: string; granted: boolean; recordedById: string; lawfulBasis: string; reason: string }[] }>(review, `/api/patients/${patient.id}/privacy`);
    for (const type of ["TREATMENT", "ELECTRONIC_RECORD"]) {
      expect(privacy.consents.find(consent => consent.type === type)).toMatchObject({ granted: false, recordedById: actor.id, lawfulBasis: "VITAL_INTERESTS", reason });
    }
    const audit = await read<{ chain: { valid: boolean }; events: { action: string; entityId: string; userId: string; facilityId: string; reason: string }[] }>(review, "/api/admin/audit/export");
    expect(audit.chain.valid).toBe(true);
    const events = audit.events.filter(event => event.action === "PATIENT_REGISTERED" && event.entityId === patient.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: actor.id, facilityId: actor.facilityId });
    expect(JSON.parse(events[0].reason)).toEqual({ registrationMode: "EMERGENCY_UNKNOWN", identityStatus: "UNIDENTIFIED" });
  } finally { await reviewContext.close(); }

  const foreignContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const foreign = await foreignContext.newPage();
    await login(foreign, "privacy@example.test", "OTHER");
    const foreignActor = (await read<{ user: Actor }>(foreign, "/api/auth/me")).user;
    expect(foreignActor.facilityId).not.toBe(actor.facilityId);
    expect(foreignActor.permissions).toEqual(expect.arrayContaining(["patient.read", "privacy.manage"]));
    const hidden = await read<{ patients: Patient[] }>(foreign, `/api/patients?q=${encodeURIComponent(patient.patientNumber)}`);
    expect(hidden.patients).toEqual([]);
    const denied = await foreign.evaluate(async patientId => {
      const response = await fetch(`/api/patients/${patientId}/privacy`);
      return { status: response.status, body: await response.json() };
    }, patient.id);
    expect(denied.status).toBe(404);
    expect(denied.body).toEqual({ error: "Patient not found", reason: "Patient not found" });
    expect(denied.body).not.toHaveProperty("patient");
    expect(denied.body).not.toHaveProperty("consents");
    expect(JSON.stringify(denied.body)).not.toContain(patient.patientNumber);
  } finally { await foreignContext.close(); }
});

test("registration mode changes preserve deliberate entries across desktop, tablet, phone and print media", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);
  const form = await registration(page);
  await expect(form.getByLabel("County *", { exact: true })).toHaveValue("");
  const entered = { givenName: "Synthetic", middleName: "Mode", familyName: "Preservation", phone: "+254700000013", estimatedAgeYears: "0", county: "Busia", subcounty: "Teso North", ward: "Synthetic ward", village: "Synthetic village" };
  for (const [name, value] of Object.entries(entered)) await form.locator(`[name="${name}"]`).fill(value);
  for (const mode of ["GUARDIAN_ASSISTED", "EMERGENCY_UNKNOWN", "STANDARD"]) {
    await form.getByLabel("Registration route").selectOption(mode);
    for (const [name, value] of Object.entries(entered)) await expect(form.locator(`[name="${name}"]`)).toHaveValue(value);
  }
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await form.getByLabel("First name *").focus();
    await page.keyboard.press("Tab");
    await expect(form.getByLabel("Middle name")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(form.getByLabel("Surname *")).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(form.getByLabel("County *", { exact: true })).toHaveValue("Busia");
    await form.screenshot({ path: testInfo.outputPath(`registration-preserved-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ media: "print" });
  // This captures existing CSS print behavior; it is not a printed clinical form.
  await expect(form).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(form.getByLabel("County *", { exact: true })).toHaveValue("Busia");
  await page.screenshot({ path: testInfo.outputPath("registration-print-media.png"), fullPage: true });
  await page.emulateMedia({ media: "screen" });
});
