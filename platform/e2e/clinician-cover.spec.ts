import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Facility code").fill("MMS");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Mwein-E2E-Password-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("heading", { name: "My work now" })).toBeVisible();
}
// Browser fetch keeps the Secure localhost test session on the browser transport.
async function request(page: Page, path: string, data?: unknown) {
  return page.evaluate(async ({ path, data }) => {
    const response = await fetch(path, data === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return { status: response.status, ok: response.ok, body: await response.json() };
  }, { path, data });
}

test("ordinary clinicians cannot acquire shortage-cover powers", async ({ page }) => {
  await login(page, "clinician@example.test");
  await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start visit from consultation" })).toHaveCount(0);
  for (const path of ["/api/visits", "/api/patients", "/api/billing/shifts", "/api/visits/00000000-0000-4000-8000-000000000001/triage"]) {
    const denied = await request(page, path, {});
    expect(denied.status, path).toBe(403);
  }
});

test("shortage-cover clinician starts in consultation, records vitals, bills and discharges", async ({ page }, testInfo) => {
  await login(page, "clinician.cover@example.test");
  await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("consultation-cover.png"), fullPage: true });
  await page.getByRole("button", { name: "Start visit from consultation" }).click();
  await expect(page.getByRole("heading", { name: "Clinic check-in" })).toBeVisible();
  await expect(page.getByPlaceholder("Name, patient number or phone")).toBeVisible();
  await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await page.getByRole("button", { name: "Register new patient", exact: true }).click();
  await page.getByLabel("First name *").fill("Browser");
  await page.getByLabel("Surname *").fill("Shortage Cover");
  await page.getByLabel("Estimated age").fill("32");
  await page.getByLabel("Sex at birth *").selectOption("MALE");
  await page.getByLabel("Phone *").fill("+254711654399");
  await page.getByLabel("Subcounty *").fill("Teso North");
  await page.getByLabel("Consent to treatment *").check();
  await page.getByLabel("Consent to electronic record *").check();
  await page.getByRole("button", { name: "Register patient and continue" }).click();
  const created = page.waitForResponse(response => response.url().endsWith("/api/visits") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Check in patient" }).click();
  const { visit } = await (await created).json();
  await expect(page.getByLabel("Temperature °C")).toHaveValue("");
  await page.getByLabel("Presenting concern / immediate red flag *").fill("Mild headache for two days");
  for (const [label, value] of [["Temperature °C", "36.8"], ["Pulse /min", "80"], ["Respirations /min", "18"], ["BP systolic", "118"], ["BP diastolic", "76"], ["SpO₂ %", "98"], ["Weight kg", "70"], ["Pain /10", "2"]]) await page.getByLabel(label).fill(value);
  await page.getByLabel("Consciousness").selectOption("ALERT");
  await page.getByLabel("Triage category *").selectOption("ROUTINE");
  await page.getByRole("button", { name: "Complete triage" }).click();
  await expect(page.getByRole("heading", { name: "Browser Shortage Cover", exact: true })).toBeVisible();

  // Exercise the real consultation endpoint under this same clinician's session.
  async function consultation(data: unknown) {
    const response = await request(page, `/api/visits/${visit.id}/consultation`, data);
    expect(response.ok, JSON.stringify(response.body)).toBeTruthy();
  }
  await consultation({ action: "SAVE_NOTES", data: {
    chiefComplaint: "Headache", complaints: [{ complaint: "Headache", durationValue: 2, durationUnit: "DAYS" }],
    historyPresentingIllness: "Mild intermittent headache for two days without red flags.", symptomDuration: "2 days",
    reviewOfSystems: "No weakness or visual disturbance.", pastMedicalHistory: "No known chronic condition.", currentMedicines: "None reported.", familySocialHistory: "No material risk reported.",
    generalExamination: "Comfortable and alert.", systemicExamination: "Neurological examination grossly normal.", plan: "Supportive care and return precautions discussed.", disposition: "OUTPATIENT",
  } });
  const diagnoses = await (await request(page, "/api/diagnoses/search?q=headache")).body;
  expect(diagnoses.results.length).toBeGreaterThan(0);
  await consultation({ action: "SAVE_DIAGNOSIS", data: { ...diagnoses.results[0], primary: true, type: "FINAL" } });
  await consultation({ action: "SIGN", data: { disposition: "OUTPATIENT" } });
  await page.reload();
  await page.getByRole("button", { name: "Consultation", exact: true }).click();
  await page.getByRole("button", { name: "Open billing" }).click();
  await page.getByText("Cashier shift", { exact: true }).click();
  await page.getByLabel("Opening cash float").fill("0");
  await page.getByRole("button", { name: "Open shift", exact: true }).click();
  await expect(page.getByText("Cashier shift opened. Cash receipts will now be attributed to it.")).toBeVisible();
  await page.getByRole("button", { name: /Browser Shortage Cover.*INV/ }).click();
  await expect(page.getByRole("heading", { name: "Submit payer claim" })).toHaveCount(0);
  const paid = page.waitForResponse(response => response.url().includes("/payments") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Record payment & issue receipt" }).click();
  const payment = await (await paid).json();
  expect(payment.payment.receipt.receiptNumber).toBeTruthy();
  expect(payment.visitCompleted).toBe(false);
  const reverse = await request(page, `/api/payments/${payment.payment.id}/reverse`, { reason: "Unauthorised test reversal" });
  expect(reverse.status).toBe(403);
  const shifts = await (await request(page, "/api/billing/shifts")).body;
  const approve = await request(page, "/api/billing/shifts", { action: "APPROVE", id: shifts.shifts[0].id });
  expect(approve.status).toBe(403);
  await page.getByRole("button", { name: "Consultation", exact: true }).click();
  const closure = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Clinical discharge", exact: true }) });
  await closure.getByLabel("Patient and visit").selectOption(visit.id);
  await closure.getByLabel("Clinical outcome").selectOption("OUTPATIENT");
  await closure.getByLabel("Closure summary, follow-up and handover").fill("Synthetic test: stable for outpatient follow-up; return precautions explained.");
  await closure.getByRole("button", { name: "Confirm clinical discharge" }).click();
  await expect(closure.getByRole("status")).toContainText("Clinical closure recorded");
  const finalVisits = await (await request(page, "/api/visits")).body;
  const finalVisit = finalVisits.visits.find((item: { id: string }) => item.id === visit.id);
  expect(finalVisit.status).toBe("DISCHARGED");
  expect(finalVisit.clinicallyClosedAt).toBeTruthy();
  expect(finalVisit.invoice.payments[0].status).toBe("CONFIRMED");
});
